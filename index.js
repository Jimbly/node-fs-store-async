/**
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2012-2020 Jimb Esser
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
**/

var assert = require('assert');
var fs = require('fs');

function FileStore(options) {
  if (typeof options === 'string') {
    options = {
      filename: options
    };
  }
  // Parse and check options
  this.base_path = options.filename;
  assert.ok(this.base_path);
  this.min_save_interval = options.min_save_interval || 1000; // Save at most once a second
  this.max_backups = options.max_backups || 3;
  this.read_only = options.read_only || false;

  this.writing = false;
  this.needs_write = false;
  this.last_saved_data_store = '';
  this.on_flush = [];
}

FileStore.prototype.load = function (options, cb) {
  var default_object = options.default_object || {};
  var self = this;
  function tryFile(retries) {
    var filename = self.filePath(retries);
    fs.readFile(filename, 'utf8', function (err, data) {
      if (!err) {
        self.last_saved_data_store = data;
        try {
          data = JSON.parse(data);
        } catch (ignored) {
        }
      }
      if (err || !data) {
        if (retries >= self.max_backups) {
          self.data_store = default_object;
          return cb();
        }
        return tryFile(retries + 1);
      }
      self.data_store = data;
      return cb();
    });
  }
  tryFile(0);
};

function createFileStore(options, cb) {
  var store = new FileStore(options);
  store.load(options, function () {
    cb(null, store);
  });
}

FileStore.prototype.onFlush = function (cb) {
  var self = this;
  if (!self.writing && !self.needs_write) {
    return setImmediate(cb);
  }
  self.on_flush.push(cb);
};

FileStore.prototype.filePath = function (retries) {
  if (!retries) {
    return this.base_path;
  } else {
    return this.base_path + '.' + (retries-1) + '.bak';
  }
};

function callOnFlushCbs(self) {
  if (!self.on_flush.length) {
    return;
  }
  var cbs = self.on_flush;
  self.on_flush = [];
  for (var ii = 0; ii < cbs.length; ++ii) {
    cbs[ii]();
  }
}

FileStore.prototype.save = function () {
  var self = this;
  if (self.writing) {
    self.needs_write = true;
    return;
  }
  var data = JSON.stringify(self.data_store, undefined, 2);
  if (data === self.last_saved_data_store || self.read_only) {
    self.needs_write = false;
    callOnFlushCbs(self);
    return;
  }
  self.last_saved_data_store = data;
  self.writing = true;
  self.needs_write = false;

  function queueNextSave() {
    setTimeout(function () {
      self.writing = false;
      if (self.needs_write) {
        self.save();
      } else {
        // Also call on_flush callbacks here, in case they were queued up during
        // this timeout interval
        callOnFlushCbs(self);
      }
    }, self.min_save_interval);
    // Calling on_flush callbacks immediately, not after min_save_interval,
    // unless there's more data queued up to be written.
    if (!self.needs_write) {
      callOnFlushCbs(self);
    }
  }
  function handleError(err) {
    // Queue up the next save so we don't leave ourselves in a broken state, in
    // case the error is caught by a global handler/domain handler/etc
    queueNextSave();
    throw err;
  }
  fs.writeFile(self.base_path + '.tmp', data, function (err) {
    if (err) {
      return handleError(err);
    }
    function removeBackup(retries, next) {
      // TODO: Could add rules here so that we delete if the time delta between
      // the two files in question is less than retries^2 hours or something so
      var filename = self.filePath(retries);
      fs.exists(filename, function (exists) {
        if (!exists) {
          return next();
        }
        if (retries === self.max_backups) {
          // just remove
          fs.unlink(filename, next);
        } else {
          removeBackup(retries+1, function () {
            fs.rename(filename, self.filePath(retries + 1), next);
          });
        }
      });
    }
    removeBackup(0, function (err) {
      if (err) {
        console.log('Error removing backup:', err);
      }
      fs.rename(self.base_path + '.tmp', self.base_path, function (err) {
        if (err) {
          return handleError(err);
        }
        queueNextSave();
      });
    });
  });
};

// call .save() manually after making modifications
FileStore.prototype.getStore = function () {
  return this.data_store;
};

FileStore.prototype.get = function (key, defvalue) {
  if (Object.prototype.hasOwnProperty.call(this.data_store, key)) {
    return this.data_store[key];
  } else {
    return defvalue;
  }
};

FileStore.prototype.set = function (key, value, cb) {
  this.data_store[key] = value;
  if (this.needs_write) {
    // Already dealt with
  } else {
    this.needs_write = true;
    // Don't call .save until next tick, so a bunch of modifications can happen
    // before a single .save() call
    setImmediate(this.save.bind(this));
  }
  if (cb) {
    this.onFlush(cb);
  }
};

exports.createFileStore = createFileStore;
