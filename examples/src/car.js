import ThreeJSOverlayView from '@ubilabs/threejs-overlay-view';
import {CatmullRomCurve3, Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader';
import {Line2} from 'three/examples/jsm/lines/Line2.js';
import {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js';
import {LineGeometry} from 'three/examples/jsm/lines/LineGeometry.js';
import {getMapsApiOptions, loadMapsApi} from '../jsm/load-maps-api';

import CAR_MODEL_URL from 'url:../assets/3d_models/ford.glb';
import PERSON_MODEL_URL from 'url:../assets/3d_models/person.glb';
import RUNNING_MODEL_URL from 'url:../assets/3d_models/running.glb';
import CYCLING_MODEL_URL from 'url:../assets/3d_models/cycling.glb';

const PIN_FRONT = new Vector3(0, 1, 0);

const VIEW_PARAMS = {
  center: {
    lat: 51.0905303, 
    lng: 71.3981646,
  },
  zoom: 18.5,
  heading: 40,
  tilt: 65
};

const ANIMATION_DURATION = 500000;
const ANIMATION_POINTS = [];

const mapContainer = document.querySelector('#map');
const sidebarContainer = document.querySelector('#sidebar');
const tmpVec3 = new Vector3();

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
const datasetId = urlParams.get('id') ? urlParams.get('id') : 1;
const isInterpolated = urlParams.get('is_interpolated') ? urlParams.get('is_interpolated') : false;
var ACTIVITY = "Unknown";


async function main() {

  var get_request = {
    method: "GET",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
  };

  const all_data_sets = await fetch("http://127.0.0.1:8000/api/v2/client/datasets", get_request);
  var all_data_sets_json = await all_data_sets.json();
  const url = (isInterpolated === "true") ? `http://127.0.0.1:8000/api/v2/client/interpolated_dataset/${datasetId}` : `http://127.0.0.1:8000/api/v2/client/dataset/${datasetId}`;
  const data_instance = await fetch(url, get_request);
  var data_instance_json = await data_instance.json();
  const data = data_instance_json["data_instances"];
  const identifier = data_instance_json["identifier"] === "null" ? "Unknown" : data_instance_json["identifier"];
  
  const identifier_div = document.createElement("div");
  identifier_div.setAttribute("id", "identifier-div");
  identifier_div.appendChild(document.createTextNode(`User: ${identifier}`));
  identifier_div.appendChild(document.createElement("div"));
  identifier_div.appendChild(document.createTextNode(`Activity: ${data[0]["activity"]}`));
  identifier_div.appendChild(document.createElement("div"));

  const text_div = document.createElement("div");
  text_div.setAttribute("id", "interpolated-div");
  text_div.appendChild(document.createTextNode(isInterpolated === "true" ? "Remove Interpolation Algorithm" : "Add Interpolation Algorithm"));
  document.getElementById("interpolation").appendChild(text_div);

  document.getElementById("interpolation").onclick = function() {
    if(isInterpolated === "true"){
      window.location = `http://localhost:1234/map.html?id=${datasetId}&is_interpolated=false`;
    }
    else{
      window.location = `http://localhost:1234/map.html?id=${datasetId}&is_interpolated=true`;
    }
  };

  document.body.appendChild(identifier_div);
  ACTIVITY = data[0]["activity"];

  var coordinates = [];
  for(let i = 0; i < data.length; i++){
    coordinates.push({
      lat: data[i]["lat"],
      lng: data[i]["lng"],
      altitude: data[i]["alt"],
    });
  }

  if(data.length !== 0){
    VIEW_PARAMS.center.lat = data[0]["lat"];
    VIEW_PARAMS.center.lng = data[0]["lng"];
  }

  ANIMATION_POINTS.push.apply(ANIMATION_POINTS, coordinates);
  coordinates.reverse();
  ANIMATION_POINTS.push.apply(ANIMATION_POINTS, coordinates);

  const map = await initMap();

  const overlay = new ThreeJSOverlayView(VIEW_PARAMS.center);
  const scene = overlay.getScene();

  overlay.setMap(map);

  if(all_data_sets_json["results"].length == 0){
    const div = document.createElement("div");
    div.setAttribute("id", "error-message");
    const no_data_message = document.createTextNode("No data :(");
    div.appendChild(no_data_message);
    sidebarContainer.appendChild(div);
    return;
  }

  
  let undefined_user_counter = 0;

  for(let i = 0; i < all_data_sets_json["results"].length; i++){
    const div = document.createElement("div");
    div.setAttribute("id", "user-div");
    const identifier = all_data_sets_json["results"][i]["identifier"] === "null" ? document.createTextNode(`Undefined User ${++undefined_user_counter}`) : document.createTextNode(all_data_sets_json["results"][i]["identifier"]);
    div.onclick = function() {
      window.location = `http://localhost:1234/map.html?id=${ all_data_sets_json["results"][i]["id"]}`;
    };
    div.appendChild(identifier);
    sidebarContainer.appendChild(div);
  }

  // create a Catmull-Rom spline from the points to smooth out the corners
  // for the animation
  const points = ANIMATION_POINTS.map(p => overlay.latLngAltToVector3(p));
  const curve = new CatmullRomCurve3(points, true, 'catmullrom', 0.2);
  curve.updateArcLengths();

  const trackLine = createTrackLine(curve);
  scene.add(trackLine);

  let pinModel = null;
  loadPinModel().then(obj => {
    pinModel = obj;
    scene.add(pinModel);

    // since loading the pin-model happened asynchronously, we need to
    // explicitly trigger a redraw.
    overlay.requestRedraw();
  });

  // the update-function will animate the pin along the spline
  overlay.update = () => {
    trackLine.material.resolution.copy(overlay.getViewportSize());

    if (!pinModel) return;

    const animationProgress =
      (performance.now() % ANIMATION_DURATION) / ANIMATION_DURATION;

    curve.getPointAt(animationProgress, pinModel.position);
    curve.getTangentAt(animationProgress, tmpVec3);
    pinModel.quaternion.setFromUnitVectors(PIN_FRONT, tmpVec3);

    overlay.requestRedraw();
  };
}

/**
 * Load the Google Maps API and create the fullscreen map.
 */
async function initMap() {
  const {mapId} = getMapsApiOptions();
  await loadMapsApi();

  return new google.maps.Map(mapContainer, {
    mapId,
    disableDefaultUI: true,
    backgroundColor: 'transparent',
    gestureHandling: 'greedy',
    ...VIEW_PARAMS
  });
}

/**
 * Create a mesh-line from the spline to render the track the pin is driving.
 */
function createTrackLine(curve) {
  const numPoints = 10 * curve.points.length;
  const curvePoints = curve.getSpacedPoints(numPoints);
  const positions = new Float32Array(numPoints * 3);

  for (let i = 0; i < numPoints; i++) {
    curvePoints[i].toArray(positions, 3 * i);
  }

  const trackLine = new Line2(
    new LineGeometry(),
    new LineMaterial({
      color: 0x0f9d58,
      linewidth: 5
    })
  );

  trackLine.geometry.setPositions(positions);
  return trackLine;
}



/**
 * Load and prepare the pin-model for animation.
 */
 async function loadPinModel() {
  const loader = new GLTFLoader();
  return new Promise(resolve => {
    var model = PERSON_MODEL_URL;
    if(ACTIVITY === "driving"){
      model = CAR_MODEL_URL;
    }
    else if(ACTIVITY === "cycling"){
      model = CYCLING_MODEL_URL;
    }
    else if(ACTIVITY === "running"){
      console.log("asdsad");
      model = RUNNING_MODEL_URL;
    }
    loader.load(model, gltf => {
      const group = gltf.scene;
      const pinModel = group.children[0];
      
      if(model === CAR_MODEL_URL){
        pinModel.scale.setScalar(0.1);
        pinModel.rotation.set(Math.PI * 2, 0, Math.PI, 'ZXY');
      }
      else if(model == PERSON_MODEL_URL){
        pinModel.scale.setScalar(2);
        pinModel.rotation.set(Math.PI / 2, 0, Math.PI, 'ZXY');
      }
      else if(model == RUNNING_MODEL_URL){
        pinModel.scale.setScalar(0.05);
        pinModel.rotation.set(Math.PI, Math.PI, Math.PI, 'ZXY');
      }
      else{
        pinModel.scale.setScalar(0.8);
        pinModel.rotation.set(Math.PI, Math.PI, Math.PI * 1.5, 'ZXY');
      }

      resolve(group);
    });
  });
}

main().catch(err => console.error(err));