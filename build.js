const archiver = require('archiver');
const fs = require('fs');
const util = require('util');
const path = require('path');

function argsort(arr) {
  const indices = new Array(arr.length);
  for(let i = 0; i < indices.length; i++) indices[i] = i;
  indices.sort((ia, ib) => (arr[ia] < arr[ib] ? -1 : 1));
  return indices;
}

function makeZipArchive(outputFile, inputDir, finishCallback) {
  const output = fs.createWriteStream(outputFile);
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });

  // listen for all archive data to be written
  // 'close' event is fired only when a file descriptor is involved
  output.on('close', () => finishCallback(archive));

  archive.pipe(output);

  fs.readdir(inputDir, (err, files) => {
    if(err) {
      throw err;
    }
    files.forEach(filename =>
      archive.file(path.join(inputDir, filename), { name: filename })
    );
    archive.finalize();
  });
}

async function main(argv) {
  const ls1 = fs.readdirSync(__dirname);
  const sourceDestPairs = [];
  ls1.filter(e => e.startsWith('out')).forEach(sDir => {
    const destIdx = ls1.indexOf('dist' + sDir.substring(3));
    if(destIdx >= 0) {
      sourceDestPairs.push({
        src: sDir,
        dest: ls1[destIdx],
        archives: []
      });
    }
  });

  sourceDestPairs.forEach(({src, dest, archives}) => {
    let unzippedList = fs.readdirSync(path.join(__dirname, src));
    let zippedList = fs.readdirSync(path.join(__dirname, dest));
    let zippedListCmp = zippedList.map(e => e.replace(/\.zip$/, ''));
    unzippedList = unzippedList.sort();
    const argsortZ = argsort(zippedListCmp);
    zippedList = zippedList.slice().map((e, i) => zippedList[argsortZ[i]]);
    zippedListCmp = zippedList.slice().map((e, i) => zippedListCmp[argsortZ[i]]);
    let zi = 0;
    for(let i = 0; i < unzippedList.length; i++) {
      while(zippedListCmp[zi] < unzippedList[i]) {
        zi++;
      }

      let willWrite = (zippedListCmp[zi] !== unzippedList[i]);
      if(!willWrite) {
        // Matching filename exists, check if unzipped is newer
        willWrite = (fs.statSync(path.join(__dirname, src, unzippedList[i], 'instrument.json')).ctimeMs >
            fs.statSync(path.join(__dirname, dest, zippedList[zi])).ctimeMs);
      }

      if(willWrite) {
        archives.push({
          str: unzippedList[i] + '.zip',
          outputFile: path.join(__dirname, dest, unzippedList[i] + '.zip'),
          inputDir: path.join(__dirname, src, unzippedList[i])
        });
      }
    }

    if(archives.length > 0) {
      console.log(dest + '/');
      archives.forEach(e => console.log('  ' + e.str));
    }
  });

  const allArchives = sourceDestPairs.reduce((acc, cur) => {
    acc.push(...cur.archives)
    return acc;
  }, []);

  for(let i = 0; i < allArchives.length; i++) {
    await new Promise((resolve) => {
      makeZipArchive(
          allArchives[i].outputFile,
          allArchives[i].inputDir,
          (archive) => {
            resolve();
          }
      );
    });
  }
}

main(process.argv).then(() => process.exit(0));
