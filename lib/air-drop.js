var connect = require("connect"),
    fs = require("fs"),
    pathLib = require("path"),
    glob = require("glob"),
    async = require("async"),
    _ = require("underscore"),
    Minimizers = require("./minimizers"),
    Cachers = require("./cachers"),
    Path = require("./path"),
    Compilers = require("./compilers");

var AirDrop = function(name) {
  var package = function(req, res, next) {
    return package.router(req, res, next);
  };

  _.extend(package, {
    packageName: name,
    paths: [],
    minimizer: Minimizers.None,
    shouldPackage: false,
    cacher: null,
    explicitlyUseBrowserRequire: null
  });

  _.extend(package, packageMethods);
  
  package.router = package._buildRouter();

  return package;
};

module.exports = AirDrop;

AirDrop.Minimizers = Minimizers;
AirDrop.Cachers = Cachers;
AirDrop.Compilers = Compilers;
AirDrop.Path = Path;

var packageMethods = {
  require: function(path, options) {
    options = options || {};
    options.type = "require";
    options.path = path;
    this.paths.push(new Path(options));
    return this;
  },

  include: function(path, options) {
    options = options || {};
    options.type = "include";
    options.path = path;
    this.paths.push(new Path(options));
    return this;
  },

  minimize: function(boolOrMinimizer) {
    if(_.isUndefined(boolOrMinimizer) || boolOrMinimizer === true) {
      this.minimizer = Minimizers.Default;
    }
    else if(!boolOrMinimizer) {
      this.minimizer = Minimizers.None;
    }
    else if(_.isFunction(boolOrMinimizer)) {
      this.minimizer = boolOrMinimizer;
    }
    return this;
  },

  package: function(bool) {
    this.shouldPackage = (typeof bool === "undefined") ? true : bool;
    return this;
  },

  cache: function(boolOrCacher) {
    if(_.isUndefined(boolOrCacher) || boolOrCacher === true) {
      this.cacher = Cachers.Default;
    }
    else if(!boolOrCacher) {
      this.cacher = Cachers.None;
    }
    else if(_.isFunction(boolOrCacher)) {
      this.cacher = boolOrCacher;
    }
    return this;
  },

  useCachedResult: function cache(key, fetchFunc, cb) {
    this.cacher ? this.cacher(key, _.bind(fetchFunc, this), cb) : fetchFunc(cb);
  },

  useBrowserRequire: function(bool) {
    this.explicitlyUseBrowserRequire = (typeof bool === "undefined") ? true : bool;
    return this;
  },

  _shouldUseBrowserRequire: function() {
    if(!_.isNull(this.explicitlyUseBrowserRequire)) {
      return this.explicitlyUseBrowserRequire;
    }
    var implicitUse = _(this.paths).any(function(path) {
      return path.type === "require"; 
    });
    return implicitUse;
  },

  source: function(cb) {
    var package = this;
    expandPaths(package.allPaths(), function(err, expandedPaths) {
      if(err) { return cb(err) }
      orderedAsyncMap(expandedPaths, _.bind(package._fetchCode, package), function(err, parts) {
        if(err) { return cb(err) }
        package.minimizer(parts.join("\n"), cb);
      });
    });
  },

  allPaths: function() {
    var all = this.paths;
    if(this._shouldUseBrowserRequire()) {
      var browserRequirePath = new Path({
        type: "include", 
        path: __dirname + "/browser-require.js"
      });
      all = [browserRequirePath].concat(all);
    }
    return all;
  },

  _buildRouter: function() {
    var package = this;

    return connect.router(function(app) {
      function deliverSource(req, res) {
        return function(err, data) {
          if(err) throw err;
          res.setHeader("Content-Type", "application/javascript");
          res.write(data);
          res.end();
        };
      }

      app.get("/air-drop/" + package.packageName + ".js", function(req, res) {
        package.useCachedResult(package.packageName, _.bind(package.source, package), deliverSource(req, res));
      });
    
      app.get("/air-drop/" + package.packageName + "/include/:filepath", function(req, res) {
        var filepath = req.params.filepath.replace(/\|/g, "/"),
            key = package.packageName + "/include/" + filepath,
            fetchFunc = function(cb) {
              var path = new Path({type: "include", path: filepath});
              readWrapFile(path, cb);
            };
        package.useCachedResult(key, fetchFunc, deliverSource(req, res));
      });

      app.get("/air-drop/" + package.packageName + "/require/:filepath", function(req, res) {
        var filepath = req.params.filepath.replace(/\|/g, "/"),
            key = package.packageName + "/require/" + filepath,
            fetchFunc = function(cb) {
              var path = new Path({type: "require", path: filepath});
              readWrapFile(path, cb);
            };
        packageuseCachedResult(key, fetchFunc, deliverSource(req, res));
      });
    });
  },

  _fetchCode: function(path, cb) {
    var wrap = this._fetchWrappedFile();
    glob(path.path, function(err, filePaths) {
      if(err) { return cb(err); }
      var expandedPaths = _(filePaths || []).map(function(filepath) {
        return new Path({type: path.type, path: filepath, name: path.name});
      });
      orderedAsyncMap(expandedPaths, wrap, function(err, parts) {
        err ? cb(err) : cb(null, parts.join("\n"))
      });
    });
  },

  _fetchWrappedFile: function() {
    var package = this;
    if(package.shouldPackage) {
      return function(path, cb) {
        readWrapFile(path, cb);
      };
    }
    else {
      return function(path, cb) {
        encodedPath = path.path.replace(/\//g, "|");
        cb(null, "document.write('<scr'+'ipt src=\"/air-drop/" + package.packageName + "/" + path.type + "/" + encodedPath + "\" type=\"text/javascript\"></scr'+'ipt>');");
      }
    }
  },

  _applyMinimization: function(code) {
    return this.minimizer(code);
  }    
};

function readWrapFile(path, cb) {
  fs.readFile(path.path, function(err, data) {
    if(err) { return cb(err); }
    var compiler = path.compiler();
    compiler(data.toString(), function(err, compiledData) {
      if(err) { return cb(err); }
      if(path.type === "require") {
        cb(null, "require.define('" + path.moduleName() + "', function(require, module, exports) {\n" + compiledData + "\n});\n");
      }
      else {
        cb(null, compiledData + "\n");
      }
    });
  });
}


function expandPaths(paths, cb) {
  orderedAsyncConcat(paths, expandPath, function(err, allPaths) {
    if(err) { return cb(err); }
    var flattened = allPaths,
        compacted = [],
        nameIndex = [];
    for(var i=0; i < flattened.length; i++) {
      var path = allPaths[i];
      if(nameIndex.indexOf(path.path) === -1) {
        nameIndex.push(path.path);
        compacted.push(path);
      }
    }
    cb(null, compacted);
  });
}

function expandPath(path, cb) {
  glob(path.path, function(err, filePaths) {
    if(err) { return cb(err); }
    cb(null, _(filePaths).map(function(newPath) { return new Path({type: path.type, path: newPath, name: path.name}); }));
  });
}

function orderedAsyncMap(arr, iterator, origCb) {
  var arrWithIndexes = _(arr).map(function(item, i) { return [item, i]; });
  var wrappedIterator = function(tuple, cb) {
    var origItem = tuple[0],
        i = tuple[1];
    iterator(origItem, function(err, result) {
      cb(err, [result, i]);
    });
  };
      
  async.map(arrWithIndexes, wrappedIterator, function(err, tuples) {
    if(err) { return origCb(err); }
    var orderedItems = [];
    _(tuples).each(function(tuple) {
      var item = tuple[0],
          i = tuple[1];
      orderedItems[i] = item;
    });
    origCb(null, orderedItems);
  });
}

function orderedAsyncConcat(arr, iterator, cb) {
  orderedAsyncMap(arr, iterator, function(err, items) {
    if(err) { return cb(err); }
    var head = items.shift();
    for(var i=0; i < items.length; i++) {
      head = head.concat(items[i]);
    }
    cb(null, head);
  });
}
