/*
 * NOTE:
 * This temporarily uses the PouchDB map reduce implementation
 * These files are modified locally until we make a more general version and
 * push it back upstream.
 * Original file:
 * https://github.com/daleharvey/pouchdb/blob/master/src/plugins/pouchdb.mapreduce.js
 */

/*global Pouch: true */

//"use strict";

// This is the first implementation of a basic plugin, we register the
// plugin object with pouch and it is mixin'd to each database created
// (regardless of adapter), adapters can override plugins by providing
// their own implementation. functions on the plugin object that start
// with _ are reserved function that are called by pouchdb for special
// notifications.

// If we wanted to store incremental views we can do it here by listening
// to the changes feed (keeping track of our last update_seq between page loads)
// and storing the result of the map function (possibly using the upcoming
// extracted adapter functions)

define([
  "app",

  "api",

  // Modules
  "addons/pouchdb/pouch.collate.js"
],

function(app, FauxtonAPI, Collate) {
  var Pouch = {};
  Pouch.collate = Collate.collate;

  function sum(values) {
    return values.reduce(function(a, b) { return a + b; }, 0);
  }

  //var MapReduce = function(db) {
  var MapReduce = function() {

    var builtInReduce = {
      "_sum": function(keys, values){
        return sum(values);
      },

      "_count": function(keys, values, rereduce){
        if (rereduce){
          return sum(values);
        } else {
          return values.length;
        }
      },

      "_stats": function(keys, values, rereduce){
        return {
          'sum': sum(values),
          'min': Math.min.apply(null, values),
          'max': Math.max.apply(null, values),
          'count': values.length,
          'sumsqr': (function(){
            var _sumsqr = 0;
            for(var idx in values){
              _sumsqr += values[idx] * values[idx];
            }
            return _sumsqr;
          })()
        };
      }
    };

    function viewQuery(fun, options) {
      console.log("IN VIEW QUERY");
      if (!options.complete) {
        return;
      }

      var results = [];
      var current = null;
      var num_started= 0;
      var completed= false;

      var emit = function(key, val) {
        //console.log("IN EMIT: ", key, val, current);
        var viewRow = {
          id: current.doc._id,
          key: key,
          value: val
        }; 
        //console.log("VIEW ROW: ", viewRow);

        if (options.startkey && Pouch.collate(key, options.startkey) < 0) return;
        if (options.endkey && Pouch.collate(key, options.endkey) > 0) return;
        if (options.key && Pouch.collate(key, options.key) !== 0) return;
        num_started++;
        if (options.include_docs) {
          // TODO:: FIX
          throw({error: "Include Docs not supported"});
          /*

          //in this special case, join on _id (issue #106)
          if (val && typeof val === 'object' && val._id){
            db.get(val._id,
                function(_, joined_doc){
                  if (joined_doc) {
                    viewRow.doc = joined_doc;
                  }
                  results.push(viewRow);
                  checkComplete();
                });
            return;
          } else {
            viewRow.doc = current.doc;
          }
          */
        }
        console.log("EMITTING: ", viewRow);
        results.push(viewRow);
      };

      // ugly way to make sure references to 'emit' in map/reduce bind to the
      // above emit
      eval('fun.map = ' + fun.map.toString() + ';');
      if (fun.reduce && options.reduce) {
        if (builtInReduce[fun.reduce]) {
          console.log('built in reduce');
          fun.reduce = builtInReduce[fun.reduce];
        }
        eval('fun.reduce = ' + fun.reduce.toString() + ';');
      }

      // exclude  _conflicts key by default
      // or to use options.conflicts if it's set when called by db.query
      var conflicts = ('conflicts' in options ? options.conflicts : false);

      //only proceed once all documents are mapped and joined
      var checkComplete= function(){
        console.log('check');
        if (completed && results.length == num_started){
          results.sort(function(a, b) {
            return Pouch.collate(a.key, b.key);
          });
          if (options.descending) {
            results.reverse();
          }
          if (options.reduce === false) {
            return options.complete(null, {rows: results});
          }

          console.log('reducing', options);
          var groups = [];
          results.forEach(function(e) {
            var last = groups[groups.length-1] || null;
            if (last && Pouch.collate(last.key[0][0], e.key) === 0) {
              last.key.push([e.key, e.id]);
              last.value.push(e.value);
              return;
            }
            groups.push({key: [[e.key, e.id]], value: [e.value]});
          });
          groups.forEach(function(e) {
            e.value = fun.reduce(e.key, e.value) || null;
            e.key = e.key[0][0];
          });
          console.log('GROUPs', groups);
          options.complete(null, {rows: groups});
        }
      };

      if (options.docs) {
        //console.log("RUNNING MR ON DOCS: ", options.docs);
        _.each(options.docs, function(doc) {
          current = {doc: doc};
          fun.map.call(this, doc);
        }, this);
        completed = true;
        return checkComplete();//options.complete(null, {rows: results});
      } else {
        //console.log("COULD NOT FIND DOCS");
        return false;
      }

      /*
      db.changes({
        conflicts: conflicts,
        include_docs: true,
        onChange: function(doc) {
          if (!('deleted' in doc)) {
            current = {doc: doc.doc};
            fun.map.call(this, doc.doc);
          }
        },
        complete: function() {
          completed= true;
          checkComplete();
        }
      });
      */
    }

    /*
    function httpQuery(fun, opts, callback) {

      // List of parameters to add to the PUT request
      var params = [];
      var body = undefined;
      var method = 'GET';

      // If opts.reduce exists and is defined, then add it to the list
      // of parameters.
      // If reduce=false then the results are that of only the map function
      // not the final result of map and reduce.
      if (typeof opts.reduce !== 'undefined') {
        params.push('reduce=' + opts.reduce);
      }
      if (typeof opts.include_docs !== 'undefined') {
        params.push('include_docs=' + opts.include_docs);
      }
      if (typeof opts.limit !== 'undefined') {
        params.push('limit=' + opts.limit);
      }
      if (typeof opts.descending !== 'undefined') {
        params.push('descending=' + opts.descending);
      }
      if (typeof opts.startkey !== 'undefined') {
        params.push('startkey=' + encodeURIComponent(JSON.stringify(opts.startkey)));
      }
      if (typeof opts.endkey !== 'undefined') {
        params.push('endkey=' + encodeURIComponent(JSON.stringify(opts.endkey)));
      }
      if (typeof opts.key !== 'undefined') {
        params.push('key=' + encodeURIComponent(JSON.stringify(opts.key)));
      }

      // If keys are supplied, issue a POST request to circumvent GET query string limits
      // see http://wiki.apache.org/couchdb/HTTP_view_API#Querying_Options
      if (typeof opts.keys !== 'undefined') {
        method = 'POST';
        body = JSON.stringify({keys:opts.keys});
      }

      // Format the list of parameters into a valid URI query string
      params = params.join('&');
      params = params === '' ? '' : '?' + params;

      // We are referencing a query defined in the design doc
      if (typeof fun === 'string') {
        var parts = fun.split('/');
        db.request({
          method: method,
          url: '_design/' + parts[0] + '/_view/' + parts[1] + params,
          body: body
        }, callback);
        return;
      }

      // We are using a temporary view, terrible for performance but good for testing
      var queryObject = JSON.parse(JSON.stringify(fun, function(key, val) {
        if (typeof val === 'function') {
          return val + ''; // implicitly `toString` it
        }
        return val;
      }));

      db.request({
        method:'POST',
        url: '_temp_view' + params,
        body: queryObject
      }, callback);
    }
    */

    function query(fun, opts, callback) {
      if (typeof opts === 'function') {
        callback = opts;
        opts = {};
      }

      if (callback) {
        opts.complete = callback;
      }

      /*
      if (db.type() === 'http') {
        return httpQuery(fun, opts, callback);
      }
      */

      if (typeof fun === 'object') {
        console.log("RUNNING VIEW QUERY", fun, opts, arguments);
        return viewQuery(fun, opts);
      }

      throw({error: "Shouldn't have gotten here"});

      /*
      var parts = fun.split('/');
      db.get('_design/' + parts[0], function(err, doc) {
        if (err) {
          if (callback) callback(err);
          return;
        }
        viewQuery({
          map: doc.views[parts[1]].map,
          reduce: doc.views[parts[1]].reduce
        }, opts);
      });
      */
    }

    return {'query': query};
  };

  // Deletion is a noop since we dont store the results of the view
  MapReduce._delete = function() { };

  //Pouch.plugin('mapreduce', MapReduce);

  return MapReduce();
});
