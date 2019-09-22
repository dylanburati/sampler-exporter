/*
npm install archiver yargs --save
*/

const archiver = require('archiver');
const fs = require('fs');
const util = require('util');
const path = require('path');
const yargs = require('yargs');
const readline = require('readline');

function pprint(obj) {
  console.log(util.inspect(obj, { depth: null }));
}

function argsort(arr) {
  const indices = new Array(arr.length);
  for(let i = 0; i < indices.length; i++) indices[i] = i;
  indices.sort((ia, ib) => (arr[ia] < arr[ib] ? -1 : 1));
  return indices;
}

const instrumentObjDefault = {
  // name: null,
  volume: 1.0
};

const FIELD_MIN_PITCH = 0x01;
const FIELD_MAX_PITCH = 0x02;
const FIELD_BASE_PITCH = 0x04;
const FIELD_MIN_VELOCITY = 0x08;
const FIELD_MAX_VELOCITY = 0x10;
const FIELD_LOOP_START = 0x20;
const FIELD_LOOP_END = 0x40;
const FIELD_LOOP_RESUME = 0x80;

const displayFlagLookup = {
  minPitch: FIELD_MIN_PITCH,
  maxPitch: FIELD_MAX_PITCH,
  basePitch: FIELD_BASE_PITCH,
  minVelocity: FIELD_MIN_VELOCITY,
  maxVelocity: FIELD_MAX_VELOCITY,
  startTime: FIELD_LOOP_START,
  resumeTime: FIELD_LOOP_RESUME,
  endTime: FIELD_LOOP_END
}

const sampleObjDefault = {
  // filename: null,
  volume: 1.0,
  minVelocity: 0,
  maxVelocity: 127,
  // minPitch: null,
  // maxPitch: null,
  attack: 0.0,
  decay: 0.0,
  sustain: 1.0,
  release: 40.0,
  // basePitch: null,
  startTime: 0.0,
  resumeTime: -1.0,
  endTime: 0.0,
  shouldUseDefaultLoopStart: true,
  shouldUseDefaultLoopResume: true,
  shouldUseDefaultLoopEnd: true,
  displayFlags: 0
};

function writeSample(allSamplesOpts, inferredOpts, thisSampleOpts) {
  // existing: Array<PartialSampleObject>
  const json = Object.assign({}, sampleObjDefault, allSamplesOpts, inferredOpts, thisSampleOpts);

  Object.keys(displayFlagLookup).forEach(k => {
    if(json[k] !== sampleObjDefault[k]) {
      json.displayFlags |= displayFlagLookup[k];
    }
  });

  return json;
}

function writeInstrument(name, inferredOptsArray) {
  const json = {
    name,
    volume: 1.0
  };

  json.samples = inferredOptsArray.map(opts => writeSample(null, opts, null));

  return json;
}

function makeZipArchive(filename, finishCallback) {
  const output = fs.createWriteStream(filename);
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });

  // listen for all archive data to be written
  // 'close' event is fired only when a file descriptor is involved
  output.on('close', () => finishCallback(archive));

  archive.pipe(output);
  return archive;
}

const argv = yargs
    .usage('Usage: $0 --name <name> [opts] <files>')
    .option('name', {
      describe: 'The name for the exported instrument',
      type: 'string'
    })
    .option('o', {
      describe: 'The directory or .zip file to export to',
      type: 'string'
    })
    .option('y', {
      describe: 'Assume yes to confirmation messages',
      default: false,
      type: 'boolean'
    })
    .option('transpose', {
      describe: 'The pitch adjustment for each sample',
      default: 0,
      type: 'number'
    })
    .option('reverse', {
      describe: 'Zones end at labelled pitches',
      default: false,
      type: 'boolean'
    })
    .option('pitch-regex', {
      describe: 'Regex to extract pitch number from filename',
      default: '([0-9]+)$',
      type: 'string'
    })
    .demandOption(['name'])
    .demandCommand(1)
    .argv;

async function main(argv) {
  let outputFile = argv.o;
  if(outputFile == null) {
    outputFile = argv.name;
  }

  const filenameReader = new Promise(resolve => {
    if(argv._.length === 1 && argv._[0] === '-') {
      process.stdin.setEncoding('utf8');
      let inData = '';
      process.stdin.on('readable', () => {
        let chunk;
        while((chunk = process.stdin.read()) !== null) {
          inData += chunk;
        }
      });

      process.stdin.on('end', () => {
        resolve(inData.split('\n').filter(e => e !== ''));
      });
    } else {
      resolve(argv._);
    }
  });

  let filenames = await filenameReader;
  let inputArray = [];
  filenames.forEach(filename => {
    if(!(/(\.wav|\.aiff?)$/.test(filename))) {
      console.error('Only .wav and .aiff samples are supported');
      process.exit(1);
    }
    fs.statSync(filename);  // ensure file exists

    const entryName = path.basename(filename);
    const noExt = entryName.replace(/(\.wav|\.aiff?)$/, '');
    const regex = new RegExp(argv.pitchRegex);
    const m = regex.exec(noExt);
    if(m == null) {
      console.error('Filename must contain MIDI start pitch');
      process.exit(2);
    }
    const startPitch = parseInt(m[1], 10);

    inputArray.push({
      filename,
      entryName,
      startPitch
    });
  });
  inputArray.sort((a, b) => a.startPitch - b.startPitch);
  const startPitches = inputArray.map(e => e.startPitch);

  const inferredOptsArray = [];
  const zoneStarts = [-1, ...startPitches, 128];
  for(let i = 0; i < inputArray.length; i++) {
    const prevStartPitch = zoneStarts[i];
    let startPitch = zoneStarts[i + 1];
    const nextStartPitch = zoneStarts[i + 2];

    const basePitch = startPitch - argv.transpose;
    let endPitch;
    if(argv.reverse) {
      endPitch = prevStartPitch + 1;
      if(i === inputArray.length - 1) {
        startPitch = 127;
      }
    } else {
      endPitch = nextStartPitch - 1;
      if(i === 0) {
        startPitch = 0;
      }
    }
    inferredOptsArray.push({
      filename: inputArray[i].entryName,
      minPitch: Math.min(startPitch, endPitch),
      basePitch,
      maxPitch: Math.max(startPitch, endPitch)
    });
  }

  pprint(inferredOptsArray);
  console.log(`Writing to ${outputFile}`);

  const confirm = new Promise(resolve => {
    if(!argv.y) {
      let rl = readline.createInterface(process.stdin, process.stdout);
      rl.question("Go? Y/n ", answer => {
        if(!answer.toLowerCase().startsWith('y')) {
          process.exit(0);
        }
        rl.close();
        resolve();
      });
    } else {
      resolve();
    }
  });

  await confirm;

  const archiveWriter = new Promise(resolve => {
    if(outputFile.endsWith('.zip')) {
      const archive = makeZipArchive(outputFile, archive => {
        console.log(`Wrote ${archive.pointer()} total bytes`);
        resolve();
      });
      for(let i = 0; i < inputArray.length; i++) {
        archive.file(inputArray[i].filename, { name: inputArray[i].entryName });
      }
      archive.append(JSON.stringify(writeInstrument(argv.name, inferredOptsArray)),
          { name: 'instrument.json' });
      archive.finalize();
    } else {
      fs.mkdirSync(outputFile, { recursive: true });
      fs.open(path.join(outputFile, 'instrument.json'), 'wx',
          (err, fd) => {
            if(err) {
              if(err.code === 'EEXIST') {
                console.error(`there is already an instrument in ${outputFile}`);
                process.exit(1);
              }
              throw err;
            }

            fs.writeSync(fd, JSON.stringify(writeInstrument(argv.name, inferredOptsArray),
                null, 2));

            inputArray.forEach(e => {
              fs.copyFileSync(e.filename, path.join(outputFile, e.entryName))
            });
            resolve();
          });
    }
  });

  return archiveWriter;
}

main(argv).then(() => { process.exit(0); });
