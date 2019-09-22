const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const sf2 = require('./node_modules/sf2-parser/dist/sf2-parser-all.min.js');
const yargs = require('yargs');

const PREFIX_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ';

const precisionLookup = {
  volume: 6,
  basePitch: 3,
  attack: 1,
  decay: 1,
  sustain: 6,
  release: 1,
  startTime: 7,
  resumeTime: 7,
  endTime: 7
};

function roundToPlaces(value, places) {
  return Number(value.toFixed(places));
}

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

const extendedObjDefault = {
  startTimeOffset: 0,
  resumeTimeOffset: 0,
  endTimeOffset: 0,
  basePitchOffset: 0,
  sampleRate: 44100,
  sampleModes: 0
};

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
  displayFlags: 0,
  // --
  ...extendedObjDefault
};

function toSampleObj(extendedObj) {
  sampleObj = Object.assign({}, extendedObj);
  sampleObj.basePitch += sampleObj.basePitchOffset;
  sampleObj.startTime = roundToPlaces(
      sampleObj.startTime + sampleObj.startTimeOffset / sampleObj.sampleRate, 7);
  sampleObj.resumeTime = roundToPlaces(
      sampleObj.resumeTime + sampleObj.resumeTimeOffset / sampleObj.sampleRate, 7);
  sampleObj.endTime = roundToPlaces(
      sampleObj.endTime + sampleObj.endTimeOffset / sampleObj.sampleRate, 7);

  Object.keys(extendedObjDefault).forEach(k => {
    delete sampleObj[k];
  });
  Object.keys(displayFlagLookup).forEach(k => {
    if(sampleObj[k] !== sampleObjDefault[k]) {
      sampleObj.displayFlags |= displayFlagLookup[k];
    }
  });
  return sampleObj;
}

function soundfont(argv) {
  const buf = fs.readFileSync(argv.sf2);
    
  const parser = new sf2.Parser(new Uint8Array(buf));
  parser.parse();
  return parser;
}

function requireFFmpeg() {
  return new Promise((resolve) => {
    child_process.exec('ffmpeg -version', { cwd: __dirname },
        (err, stdout, stderr) => {
          if(stdout.includes('ffmpeg version')) {
            resolve();
          } else {
            console.error('Please install FFmpeg');
            process.exit(1);
          }
        });
  });
}

function extractSample(parser, outputWav) {
  const indexM = /-([0-9]{4})/.exec(outputWav);
  const index = parseInt(indexM[1], 10);
  const outputRaw = outputWav.replace('.wav', '.raw');
  return new Promise((resolve) => {
    fs.open(outputWav, 'r', (err, fd) => {
      if(err) {
        if(err.code === 'ENOENT') {
          const fd = fs.openSync(outputRaw, 'w');
          fs.writeSync(fd, parser.sample[index]);
          child_process.exec(
              `ffmpeg -f s16le -ar ${parser.sampleHeader[index].sampleRate} -i "${outputRaw}" "${outputWav}"`,
              { cwd: __dirname },
              (err, stdout, stderr) => {
               fs.unlinkSync(outputRaw);
               resolve();
              });
        } else {
          throw err;
        }
      }
    });
  });
}

function getInstrumentName(instrument) {
  let name;
  const nameEnd = instrument.name.indexOf('\u0000');
  if(nameEnd < 0) {
    name = instruments.name;
  } else {
    name = instrument.name.substring(0, nameEnd);
  }
  
  return name;
}

function getSamples(parser, instrument, json2, debug) {
  const json = Object.assign({
    name: getInstrumentName(instrument),
    volume: 1.0,
    samples: []
  }, json2);
  if(debug >= 2) {
    console.log(util.inspect(instrument, { depth: null }));
  }

  if(instrument.info.length > 0) {
    instrument.info.reduce((acc, cur, i) => {
      const next = Object.assign({}, acc);
      next.filename = null;
      next.basePitch = null;
      let sampleId = -1;
      cur.generatorSequence.forEach(gen => {
        if(gen.type === 'sampleID') {
          sampleId = gen.value.amount;
          next.filename = `soundfont-${gen.value.amount.toString().padStart(4, '0')}.wav`;
        } else if(gen.type === 'initialAttenuation') { 
          next.volume = roundToPlaces(Math.pow(10.0, -gen.value.amount / 200), 6);
        } else if(gen.type === 'velRange') {
          next.minVelocity = gen.value.lo;
          next.maxVelocity = gen.value.hi;
        } else if(gen.type === 'keyRange') {
          next.minPitch = gen.value.lo;
          next.maxPitch = gen.value.hi;
        } else if(gen.type === 'attackVolEnv') {
          next.attack = roundToPlaces(1000 * Math.pow(2.0, gen.value.amount / 1200), 1);
        } else if(gen.type === 'decayVolEnv') {
          next.decay = roundToPlaces(1000 * Math.pow(2.0, gen.value.amount / 1200), 1);
        } else if(gen.type === 'sustainVolEnv') {
          next.sustain = roundToPlaces(Math.pow(10.0, -gen.value.amount / 200), 6);
        } else if(gen.type === 'releaseVolEnv') {
          next.release = roundToPlaces(1000 * Math.pow(2.0, gen.value.amount / 1200), 1);
        } else if(gen.type === 'overridingRootKey') {
          next.basePitch = gen.value.amount;
        } else if(gen.type === 'coarseTune') {
          next.basePitchOffset -= gen.value.amount;
        } else if(gen.type === 'fineTune') {
          next.basePitchOffset -= 0.01 * gen.value.amount;
        } else if(gen.type === 'sampleModes') {
          next.sampleModes = gen.value.amount;
        } else if(gen.type === 'startAddrsOffset') {
          next.startTimeOffset += gen.value.amount;
        } else if(gen.type === 'startAddrsCoarseOffset') {
          next.startTimeOffset += gen.value.amount * 0x8000;
        } else if(gen.type === 'startloopAddrsOffset') {
          next.resumeTimeOffset += gen.value.amount;
        } else if(gen.type === 'startloopAddrsCoarseOffset') {
          next.resumeTimeOffset += gen.value.amount * 0x8000;
        } else if(gen.type === 'endloopAddrsOffset') {
          next.endTimeOffset += gen.value.amount;
        } else if(gen.type === 'endloopAddrsCoarseOffset') {
          next.endTimeOffset += gen.value.amount * 0x8000;
        }
      });
      if(sampleId >= 0) {
        const sampleHeader = parser.sampleHeader[sampleId];
        if(sampleHeader.originalPitch != null) {
          if(next.basePitch == null) next.basePitch = sampleHeader.originalPitch;
        }
        if(sampleHeader.pitchCorrection != null) {
          next.basePitchOffset -= 0.01 * sampleHeader.pitchCorrection;
        }
        if(sampleHeader.startLoop != null && next.sampleModes === 1) {
          next.resumeTime = sampleHeader.startLoop / sampleHeader.sampleRate;
        }
        if(sampleHeader.endLoop != null) {
          next.endTime = sampleHeader.endLoop / sampleHeader.sampleRate; 
        }
        next.sampleRate = sampleHeader.sampleRate;

        if(next.basePitch != null) {
          json.samples.push(toSampleObj(next));
        }
        if(debug >= 2) {
          console.log(util.inspect(sampleHeader, { depth: null }));
        }
      }
      return (i === 0 ? next : acc);
    }, sampleObjDefault);
  }
  if(debug === 1) {
    process.stdout.write(JSON.stringify(json, null, 2));
  }

  return json;
}

async function writeInstrument(parser, outputDir, json, onFail) {
  const outputFd = await new Promise(resolve => {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.open(path.join(outputDir, 'instrument.json'), 'wx',
        (err, fd) => {
          if(err) {
            if(err.code === 'EEXIST') {
              console.error(`there is already an instrument in ${outputDir}`);
              if(onFail != null) {
                return onFail();
              } else {
                resolve(false);
                return;
              }
            }
            throw err;
          }
          resolve(fd);
        });
  });
  if(outputFd !== false) {
    fs.writeSync(outputFd, JSON.stringify(json, null, 2));

    for(let i = 0; i < json.samples.length; i++) {
      await extractSample(parser, path.join(outputDir, json.samples[i].filename));
    }
  }
}

async function exportInstrument(argv) {
  const parser = await soundfont(argv);
  const isFileOutput = argv.o !== '-';
  let debug = (argv.debug ? 2 : (isFileOutput ? 0 : 1));
  const instrument = parser.getInstruments().find(t =>
      argv.srcname === getInstrumentName(t));
  if(instrument == null) {
    console.error('Instrument not found');
    process.exit(2);
  }
  const instrumentJson = getSamples(parser, instrument, { name: argv.destname }, debug);
  if(isFileOutput) {
    await requireFFmpeg();
    const outputDir = argv.o;
    await writeInstrument(parser, outputDir, instrumentJson, () => process.exit(1));
  }
  
  return 0;
}

async function exportAllInstruments(argv) {
  await requireFFmpeg();
  const parser = await soundfont(argv);
  const outputDir = argv.o;
  fs.mkdirSync(outputDir, { recursive: true });

  const instruments = parser.getInstruments().slice(0, -1);
  const jsonList = instruments.map(t => getSamples(parser, t, null, 0));
  for(let i = 0; i < jsonList.length; i++) {
    if(!(/[/\\]GS?$/.test(jsonList[i].name))) {
      const dir2 = jsonList[i].name.replace('/', '_').replace('\\', '_');
      await writeInstrument(parser, path.join(outputDir, dir2), jsonList[i]);
    }
  }
}

async function listInstruments(argv) {
  const parser = await soundfont(argv);
  const instruments = parser.getInstruments().slice(0, -1);
  instruments.forEach(t => {
    console.log(getInstrumentName(t));
  });
} 

yargs
  .command('export <sf2>', 'export an instrument from the soundfont',
      (yargs) => {
        return yargs
          .positional('sf2', {
            describe: 'The soundfont file',
            type: 'string'
          })
          .option('srcname', {
            describe: 'The name of the MIDI instrument',
            demandOption: true,
            type: 'string'
          })
          .option('destname', {
            describe: 'The name of the exported instrument',
            demandOption: true,
            type: 'string'
          })
          .option('o', {
            describe: 'The directory to export to, or - for stdout',
            demandOption: true,
            type: 'string',
          })
          .option('debug', {
            describe: 'Print extra info. Only valid with `-o -`'
          });
      },
      // handler
      exportInstrument
  )
  .command('exportall <sf2>', 'export all the instruments from the soundfont',
      (yargs) => {
        return yargs
          .positional('sf2', {
            describe: 'The soundfont file',
            type: 'string'
          })
          .option('o', {
            describe: 'The directory to export to',
            demandOption: true
          });
      },
      // handler
      exportAllInstruments
  )
  .command('list <sf2>', 'list the instrument names in the soundfont',
      (yargs) => {
        return yargs
          .positional('sf2', {
            describe: 'The soundfont file',
            type: 'string'
          });
      },
      // handler
      listInstruments
  )
  .argv

