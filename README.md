# Sampler Exporter

A collection of tools for making self-contained instrument archives, to be used in the
[Sampler](https://github.com/dylanburati/Sampler) Android app.

## Install

```bash
$ git clone https://github.com/dylanburati/sampler-exporter
$ cd sampler-exporter
$ npm install

# For converting from soundfonts
$ sudo apt-get install ffmpeg
```

Instructions for installing FFmpeg can be found here: [https://github.com/adaptlearning/adapt_authoring/wiki/Installing-FFmpeg]()

## Usage

To create an instrument from a list of samples:

```bash
$ node make-instrument.js --name "Piccolo" -o "out/Piccolo" piccolo-*.wav
[ { filename: 'piccolo-48.wav',
    minPitch: 0,
    basePitch: 48,
    maxPitch: 59 },
  { filename: 'piccolo-60.wav',
    minPitch: 60,
    basePitch: 60,
    maxPitch: 71 },
  { filename: 'piccolo-72.wav',
    minPitch: 72,
    basePitch: 72,
    maxPitch: 127 } ]
Writing to out/Piccolo
Go? Y/n y

$ node make-instrument.js --help
Usage: make-instrument.js --name <name> [opts] <files>

Options:
  --help         Show help                                             [boolean]
  --version      Show version number                                   [boolean]
  --name         The name for the exported instrument        [string] [required]
  -o             The directory or .zip file to export to                [string]
  -y             Assume yes to confirmation messages  [boolean] [default: false]
  --transpose    The pitch adjustment for each sample      [number] [default: 0]
  --reverse      Zones end at labelled pitches        [boolean] [default: false]
  --pitch-regex  Regex to extract pitch number from filename
                                                 [string] [default: "([0-9]+)$"]
```

To convert an instrument from a soundfont file (.sf2)

```bash
$ node soundfont.js export ../sf2/example.sf2 --srcname "French Horn" --destname "Cor Français" -o "out/CorFrancais"

$ node soundfont.js --help
soundfont.js [command]

Commands:
  soundfont.js export <sf2>     export an instrument from the soundfont
  soundfont.js exportall <sf2>  export all the instruments from the soundfont
  soundfont.js list <sf2>       list the instrument names in the soundfont
```