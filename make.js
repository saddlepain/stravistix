var fs = require('fs');
var path = require('path');
var join = path.join;
var nodeCopy;
var ChromeExtension;

var HOOK_FOLDER = __dirname + '/hook/';
var EXT_FOLDER = HOOK_FOLDER + 'extension/';
var DIST_FOLDER = __dirname + '/dist/';
var BUILD_FOLDER = __dirname + '/builds/';
var PACK_FOLDER = __dirname + '/pack/';
var AUTOUPDATE_URL = 'https://raw.githubusercontent.com/saddlepain/stravistixchannel/develop/';

var action = process.argv.slice(2)[0];

setTimeout(function() {

    if (typeof action === 'undefined' || (action !== 'init' && action !== 'dist' && action !== 'build' && action !== 'pack' && action !== 'clean')) {

        showUsage();

    } else {

        switch (action) {

            case 'init':
                init();
                break;

            case 'dist':
                dist();
                break;

            case 'build':
                build();
                break;

            case 'clean':
                clean();
                break;

            case 'pack':
                pack();
                break;
        }
    }

}.bind(this), 0);

/**
 *
 */
var init = function(callback) {

    clean(function() {

        var exec = require('child_process').exec;

        var child = exec('npm install', function(error, stdout, stderr) {

            process.chdir(HOOK_FOLDER);

            console.log(stdout);

            if (error !== null) {

                console.log('exec error: ' + error);

            } else {

                process.chdir(EXT_FOLDER);

                exec('npm install', function(error, stdout, stderr) {

                    process.chdir('..');

                    console.log(stdout);

                    if (error !== null) {

                        console.log('exec error: ' + error);

                    } else {

                        console.log('Node dependencies are installed.');

                        if (typeof callback !== 'undefined') {
                            callback();
                        }
                    }
                }.bind(this));
            }

        }.bind(this));

    }.bind(this));

};


/**
 *
 */
var dist = function(callback) {

    init(function() {

        // Init finish require are now possible
        nodeCopy = require('ncp').ncp;
        console.log('Making distribution folder...');

        var options = {
            filter: function(filenameToCopy) {

                if (filenameToCopy.match('/docs/') ||
                    filenameToCopy.match('/tests/') ||
                    filenameToCopy.match('/test/') ||
                    filenameToCopy.match('/demo/') ||
                    filenameToCopy.match('/grunt/') ||
                    filenameToCopy.match('/.*\\.gzip$') ||
                    filenameToCopy.match('/.*\\.md$') ||
                    filenameToCopy.match('/.*\\.idea$') ||
                    filenameToCopy.match('/package\\.json') ||
                    filenameToCopy.match('/bower\\.json')) {
                    return false;
                }
                return true;
            }
        }

        // Copy extension/ folder to ../dist/ folder
        nodeCopy(EXT_FOLDER, DIST_FOLDER, options, function(err) {
            if (err) {
                return console.error(err);
            } else {
                console.log('Distribution folder finished. Sources are in dist/');
                if (typeof callback !== 'undefined') {
                    callback();
                }
            }
        });
    });
};


/**
 *
 */
var build = function() {

    dist(function() {

        if (!fs.existsSync(BUILD_FOLDER)) {
            fs.mkdirSync(BUILD_FOLDER);
        }

        // Switch to dist/ folder
        process.chdir(DIST_FOLDER);

        var buildName = generateBuildName(DIST_FOLDER + '/manifest.json', 'zip');
        var outputPath = BUILD_FOLDER + '/' + buildName;
        var archiver = require('archiver');
        var output = fs.createWriteStream(outputPath);
        var zipArchive = archiver('zip');

        output.on('close', function() {
            console.log('Build finished in ' + BUILD_FOLDER + buildName);
        });

        zipArchive.pipe(output);

        zipArchive.bulk([{
            src: ['**/*'],
            cwd: '.',
            expand: true
        }]);

        zipArchive.finalize(function(err, bytes) {
            if (err) {
                throw err;
            }
            console.log('done:', base, bytes);
        });
    });
};


var pack = function() {

    var computedNextSubDevVersion = function(fromVersion) {
        var devSubVersion = fromVersion.split('.')[3];
        var toVersion;
        if (devSubVersion) {
            toVersion = fromVersion.slice(0, fromVersion.lastIndexOf('.')) + '.' + (parseInt(devSubVersion) + 1);
        } else {
            toVersion = fromVersion + '.' + 1;
        }
        return toVersion;
    };

    var fetchLastestDevVersion = function(callback) {
        // Fetch current version
        var https = require('https');
        var options = {
            host: 'raw.githubusercontent.com',
            port: 443,
            path: '/saddlepain/stravistixchannel/develop/update.xml',
            method: 'GET'
        };
        var req = https.request(options, function(res) {
            res.on('data', function(d) {
                var XML = require('pixl-xml');
                var jsonUpdate = XML.parse(d);
                callback(null, jsonUpdate.app.updatecheck.version);
            });
        });
        req.end();
        req.on('error', function(e) {
            console.error(e);
            callback(e, null);
        });
    };

    var updateDistManifestFileForPacking = function(manifestFile, callback) {
        var manifestData = JSON.parse(fs.readFileSync(manifestFile).toString());
        manifestData.update_url = AUTOUPDATE_URL + '/update.xml';

        fetchLastestDevVersion(function(err, latestVersion) {

            if (err) {
                callback(err);
                return;
            }

            manifestData.version = computedNextSubDevVersion(latestVersion);
            manifestData.version_name = manifestData.version + ' Developer Preview';
            fs.writeFileSync(manifestFile, JSON.stringify(manifestData));

            callback(null);
        });
    };

    dist(function() {

        ChromeExtension = require("crx");

        console.log('Packaging crx file from dist/ folder...');
        console.log('Creating ' + PACK_FOLDER + ' folder...');
        fs.mkdirSync(PACK_FOLDER);

        // Some change into dist manifest file... add update url .. edit version..
        updateDistManifestFileForPacking(DIST_FOLDER + '/manifest.json', function(err) {

            if (err) {
                console.error(err);
                return;
            }

            // Setup crx name
            var crxFilename = generateBuildName(DIST_FOLDER + '/manifest.json', 'crx');

            var crx = new ChromeExtension({
                codebase: AUTOUPDATE_URL + crxFilename,
                rootDirectory: DIST_FOLDER,
                privateKey: fs.readFileSync(join(__dirname, 'hook/extension.pem'))
            });

            // Package it
            crx.load().then(function(crx) {

                crx.pack().then(function(crxBuffer) {

                    var crxPath = PACK_FOLDER + crxFilename;

                    console.log('Writing crx file to ' + crxPath);

                    fs.writeFile(crxPath, crxBuffer, function(err) {
                        if (err) throw err;
                        console.log('crx saved at ' + crxPath);
                    });

                    // Write update XML file
                    var updateXML = crx.generateUpdateXML();
                    var updateXMLPath = join(PACK_FOLDER, 'update.xml');
                    fs.writeFile(updateXMLPath, updateXML);
                    console.log('update.xml file saved at ' + updateXMLPath);
                });
            });

        }.bind(this));

    });
};

var clean = function(callback) {
    console.log('Cleaning builds/, dist/ pack/ and node_modules/ folders...');
    deleteFolderRecursive('node_modules');
    deleteFolderRecursive(EXT_FOLDER + 'node_modules');
    deleteFolderRecursive(DIST_FOLDER);
    deleteFolderRecursive(BUILD_FOLDER);
    deleteFolderRecursive(PACK_FOLDER);
    console.log('builds/, dist/ pack/ and node_modules/ folders cleaned');
    if (callback) {
        callback();
    }
};

/**
 *
 */
var showUsage = function() {
    console.log('Usage:');
    console.log('node ' + path.basename(__filename) + ' <init|dist|build|clean|pack>\r\n');
    console.log('init: Install dependencies');
    console.log('dist: Create distribution folder');
    console.log('build: Create archive of distribution folder');
    console.log('clean: Clean builds/, dist/ and node_modules/ folders');
};

/**
 *
 */
var deleteFolderRecursive = function(path) {
    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach(function(file, index) {
            var curPath = path + "/" + file;
            if (fs.lstatSync(curPath).isDirectory()) { // recurse
                deleteFolderRecursive(curPath);
            } else { // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
};

/**
 *
 */
var generateBuildName = function(manifestFile, type) {

    if (!type && type != 'zip' && type != 'crx') {
        console.error('ERROR: build type must be "zip" or "crx", exit');
        process.exit(1);
    }
    var manifestData = JSON.parse(fs.readFileSync(manifestFile).toString());

    var d = new Date();
    return 'StravistiX_v' + manifestData.version + '_' + d.toDateString().split(' ').join('_') + '_' + (d.toLocaleTimeString().split(':').join('_')).replace(' ', '_') + '.' + type;
};
