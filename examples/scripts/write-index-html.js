const fs = require('fs');

fs.readdir('./src', (err, entries) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
});