'use strict';

var events    = require('events');
var fs        = require('fs');
var realpath  = require('fs.realpath');
var log       = require('util').debuglog(require('../package').name);
var trace     = require('util').debuglog(require('../package').name + '-trace');
var os        = require('os');
var path      = require('path');
var util      = require('util');

module.exports = function (ts) {
	function Host(currentDirectory, opts) {
		this.currentDirectory = this.getCanonicalFileName(path.resolve(currentDirectory));
		this.outputDirectory = this.getCanonicalFileName(path.resolve(opts.outDir));
		this.rootDirectory = this.getCanonicalFileName(path.resolve(opts.rootDir));
		this.languageVersion = opts.target;
		this.files = {};
		this.previousFiles = {};
		this.output = {};
		this.version = 0;
		this.error = false;
	}

	util.inherits(Host, events.EventEmitter);

	Host.prototype._reset = function () {
		this.previousFiles = this.files;
		this.files = {};
		this.output = {};
		this.error = false;
		++this.version;

		log('Resetting (version %d)', this.version);
	};

	Host.prototype._addFile = function (filename, root) {

		// Ensure that the relative, non-canonical file name is what's passed
		// to 'createSourceFile', as that's the name that will be used in error
		// messages, etc.

		var relative = ts.normalizeSlashes(path.relative(
			this.currentDirectory,
			path.resolve(
				this.currentDirectory,
				filename
			)
		));
		var canonical = this._canonical(filename);
		trace('Parsing %s', canonical);

		var text;
		try {
			text = fs.readFileSync(filename, 'utf-8');
		} catch (ex) {
			return;
		}

		var file;
		var current = this.files[canonical];
		var previous = this.previousFiles[canonical];
		var version;

		if (current && current.contents === text) {
			file = current.ts;
			version = current.version;
			trace('Reused current file %s (version %d)', canonical, version);
		} else if (previous && previous.contents === text) {
			file = previous.ts;
			version = previous.version;
			trace('Reused previous file %s (version %d)', canonical, version);
		} else {
			file = ts.createSourceFile(relative, text, this.languageVersion, true);
			version = this.version;
			trace('New version of source file %s (version %d)', canonical, version);
		}

		this.files[canonical] = {
			filename: relative,
			contents: text,
			ts: file,
			root: root,
			version: version
		};
		this.emit('file', canonical, relative);

		return file;
	};

	Host.prototype.getSourceFile = function (filename) {
		if (filename === '__lib.d.ts') {
			return this.libDefault;
		}
		var canonical = this._canonical(filename);
		if (this.files[canonical]) {
			return this.files[canonical].ts;
		}
		return this._addFile(filename, false);
	};

	Host.prototype.getDefaultLibFileName = function () {
		var libPath = path.dirname(ts.sys.getExecutingFilePath());
		var libFile = ts.getDefaultLibFileName({ target: this.languageVersion });
		return path.join(libPath, libFile);
	};

	Host.prototype.writeFile = function (filename, data) {

		var outputCanonical = this._canonical(filename);
		log('Cache write %s', outputCanonical);
		this.output[outputCanonical] = data;

		var sourceCanonical = this._inferSourceCanonical(outputCanonical);
		var sourceFollowed = this._follow(path.dirname(sourceCanonical)) + '/' + path.basename(sourceCanonical);

		if (sourceFollowed !== sourceCanonical) {
			outputCanonical = this._inferOutputCanonical(sourceFollowed);
			log('Cache write (followed) %s', outputCanonical);
			this.output[outputCanonical] = data;
		}
	};

	Host.prototype.getCurrentDirectory = function () {
		return this.currentDirectory;
	};

	Host.prototype.getCanonicalFileName = function (filename) {
		return ts.normalizeSlashes(ts.sys.useCaseSensitiveFileNames ? filename : filename.toLowerCase());
	};

	Host.prototype.useCaseSensitiveFileNames = function () {
		var platform = os.platform();
		return platform !== 'win32' && platform !== 'win64' && platform !== 'darwin';
	};

	Host.prototype.getNewLine = function () {
		return os.EOL;
	};

	Host.prototype.fileExists = function (filename) {
		return ts.sys.fileExists(filename);
	};

	Host.prototype.readFile = function (filename) {
		return ts.sys.readFile(filename);
	};

	Host.prototype._rootFilenames = function () {

		var rootFilenames = [];

		for (var filename in this.files) {
			if (!Object.hasOwnProperty.call(this.files, filename)) continue;
			if (!this.files[filename].root) continue;
			rootFilenames.push(filename);
		}
		return rootFilenames;
	}

	Host.prototype._output = function (filename) {

		var outputCanonical = this._inferOutputCanonical(filename);
		log('Cache read %s', outputCanonical);

		var output = this.output[outputCanonical];
		if (!output) {
			log('Cache miss on %s', outputCanonical);
		}
		return output;
	}

	Host.prototype._canonical = function (filename) {
		return this.getCanonicalFileName(path.resolve(
			this.currentDirectory,
			filename
		));
	}

	Host.prototype._inferOutputCanonical = function (filename) {

		var sourceCanonical = this._canonical(filename);
		var outputRelative = path.relative(
			this.rootDirectory,
			sourceCanonical
		);
		var outputCanonical = this.getCanonicalFileName(path.resolve(
			this.outputDirectory,
			outputRelative
		));
		return outputCanonical;
	}

	Host.prototype._inferSourceCanonical = function (filename) {

		var outputCanonical = this._canonical(filename);
		var outputRelative = path.relative(
			this.outputDirectory,
			outputCanonical
		);
		var sourceCanonical = this.getCanonicalFileName(path.resolve(
			this.rootDirectory,
			outputRelative
		));
		return sourceCanonical;
	}

	Host.prototype._follow = function (filename) {

		filename = this._canonical(filename);
		var basename;
		var parts = [];

		do {
			var stats = fs.lstatSync(filename);
			if (stats.isSymbolicLink()) {
				filename = realpath.realpathSync(filename);
			} else {
				basename = path.basename(filename);
				if (basename) {
					parts.unshift(basename);
					filename = path.dirname(filename);
				}
			}
		} while (basename);

		return ts.normalizeSlashes(filename + parts.join('/'));
	};

	return Host;
};
