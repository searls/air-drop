# AirDrop

[![Build Status](https://secure.travis-ci.org/chrisjpowers/air-drop.png)](http://travis-ci.org/chrisjpowers/air-drop)

`AirDrop` is a Node.js Connect middleware for compiling, concatenating and minimizing
 your JS/Coffee source files and delivering them to the browser on-the-fly. 
Personally I think this approach is preferable to using build scripts, file watchers, etc.

## Install

Install with `npm`:

```
npm install air-drop
```

You can run the specs with `npm` as well:

```
cd node_modules/air-drop
npm test
```

## Including JS Files

All the following examples assume you have some kind of a Connect-compatible server:

```javascript
var server = require("connect").createServer();
```

`AirDrop` objects are instantiated with a package name that will be used in the package's
URL. To include JS files, use the `include` method. Files will be added to the package
in the order you include them.

```javascript
var package = AirDrop("my-package").include("public/js/jquery.js")
                                   .include("public/js/file1.js")
                                   .include("public/js/file2.js");
server.use(package);
```

In your client-side code, you can load your JS package with a script tag:

```html
<script type="text/javascript" src="/air-drop/my-package.js"></script>
```

## Globbing Paths

Rather than including paths one by one, you can use glob wildcards:

```javascript
var package = AirDrop("my-package").include("public/js/jquery.js")
                                   .include("public/js/**/*.js")
```

This will first add `jquery.js`, then any other JS files nested inside `public/js`.
NOTE: Because `jquery.js` has already been included, it will not be included a
second time by the glob include.

## Requiring JS Modules

Sharing JS source files between Node and the browser is difficult because the browser
does not natively implement Node's file loading system using `require` and `exports`.
This is easy with `AirDrop`, though -- just use the `require` method instead of `include`
and `AirDrop` will wrap your modules in an AMD `define` block for use in the browser:

```javascript
// in lib/my-module.js
exports.helloWorld = function() { return "Hello World!"; };

// in public/js/demo.js
var MyModule = require("lib/my-module");
MyModule.helloWorld(); // "Hello World!"

// in your Node script
var package = AirDrop("my-package").require("lib/my-module.js")
                                   .include("public/js/demo.js");
server.use(package);
```

By default, the package can be accessed in the browser by using `require` 
and the path. This is not always appropriate, however, so you can pass in 
an options object with a `name` key to explicitly set the module's name in
the browser. For example, reusing the `underscore` node lib:

```javascript
// in your Node script
var package = AirDrop("my-package").require(__dirname + "/../node_modules/underscore/underscore.js", {name: "underscore"});

// in the browser
var _ = require("underscore");
```

Whenever you `require` a file with `AirDrop`, it will automatically include
the `browser-require` library that makes all these require statements work
in the browser. If you have multiple packages being loaded onto a page, you
will only need `browser-require` included in one of them, so you will want
to prevent its inclusion in the others with `useBrowserRequire(false)`:

```javascript
var package1 = AirDrop("package1").require("lib/mod1");
var package2 = AirDrop("package2").require("lib/mod2").useBrowserRequire(false);
```

As you may have guessed, `useBrowserRequire(true)` includes `browser-require`
the package even if its `require` method was never used.

## Packaging Your Code

By default, `AirDrop` does not package your code, as this makes debugging difficult
in development. Rather, `/air-drop/my-package.js` will dynamically add a script tag
for each of your included scripts so that they will be loaded individually.

When you are ready for your code to be packaged, use the `package` method:

```javascript
var package = AirDrop("my-package").require("lib/my-module.js")
                                   .include("public/js/demo.js")
                                   .package();
```

The `package` method accepts an optional boolean so that you can package conditionally.
For example, you may only want to package your code if the NODE_ENV environment
variable is set to `production`:

```javascript
var package = AirDrop("my-package").require("lib/my-module.js")
                                   .include("public/js/demo.js")
                                   .package(process.env.NODE_ENV === "production");
```

## Minimizing Your Code

Minimizing your client code is a good way to reducing file size as well as obfuscating
it from prying eyes. Like the `package` method, the `minimize` method can be called
without an argument, or with a boolean:

```javascript
var package = AirDrop("my-package").require("lib/my-module.js")
                                   .include("public/js/demo.js")
                                   .package(process.env.NODE_ENV === "production")
                                   .minimize(process.env.NODE_ENV === "production");
                                   // or just .minimize()
```

By default, the `minimize` function will use `uglify` to minimize your code. If you
want to customize how your code is minimized, you can pass `minimize` a function instead:

```javascript
function customMinimizer(data, cb) {
  try {
    // do minimization work to data
    cb(null, data);
  } catch(e) {
    cb(e);
  }
}

var package = AirDrop("my-package").require("lib/my-module.js")
                                   .include("public/js/demo.js")
                                   .package()
                                   .minimize(customMinimizer);
```

## Caching Your Packages

Since building these packages can be an expensive operation, you will probably want to cache
the built packages in memory so they are only built once while your process is running.
You can do this using the `cache` method, which takes an optional boolean like `package`
and `minimize`:


```javascript
var package = AirDrop("my-package").require("lib/my-module.js")
                                   .include("public/js/demo.js")
                                   .package(process.env.NODE_ENV === "production")
                                   .minimize(process.env.NODE_ENV === "production")
                                   .cache(process.env.NODE_ENV === "production");
                                   // or just .cache()
```

By default, the `cache` method will use a simple in-memory cache. If you want to use
a different caching method you can pass your own custom cacher to `cache`:

```javascript
function customCacher(key, orig, cb) {
  var cachedData = SomeCache.get(key);
  if(cachedData) {
    cb(null, cachedData);
  } else {
    orig(function(err, data) {
      if(err) { return cb(err); }
      SomeCache.set(key, data);
      cb(null, data);
    });
  }
}

var package = AirDrop("my-package").require("lib/my-module.js")
                                   .include("public/js/demo.js")
                                   .package()
                                   .cache(customCacher);
```

## Compiling CoffeeScript (and more)

Using CoffeeScript? No problem, any CoffeeScripts will be automatically compiled for you!

If you have some other kind of source that needs to be compiled, you can add your own custom
compiler. For example, if you need to compile "CrazyScript":

```javascript
var CrazyScriptCompiler = function(data, cb) {
  try {
    // do work on data
    cb(null, data);
  }
  catch(e) {
    cb(e);
  }
};

// pathObj is an AirDrop.Path object, and the test returns true/false for whether our
// CrazyScriptCompiler should be used for this path object.
var CrazyScriptTest = function(pathObj) {
  return /crazyscript$/.test(pathObj.path);
};

AirDrop.Compilers.add(CrazyScriptCompiler, CrazyScriptTest);

var package = AirDrop("my-package").require("lib/my-module.crazyscript")
```

You can also explicitly use a custom compiler on a specific include/require:

```javascript
var package = AirDrop("my-package").require("lib/my-module.js", {compiler: CrazyScriptCompiler});
```

## TODO

- Specs!
- More flexibility in naming AMD modules other than by path
- Ability to slice out "server-only" code from shared files
- Improve caching mechanism to integrate storage outside of memory (flat files, memcached)
- Inline documentation
