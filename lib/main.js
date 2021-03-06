var nano = require('nano'),
  mustacheExpress = require('mustache-express'),
  bodyParser = require('body-parser'),
  marked = require("marked"),
  request = require("request"),
  Busboy = require('busboy'),
  syncDesignDoc = require('./syncDesignDoc');


marked.setOptions({
  gfm: true,
  breaks: true,
  highlight: function (code) {
    return require('highlight.js').highlightAuto(code).value;
  }
});

var urlCouchDb = "";

// options :{
//    config: { host: “…”, port: “…” },
//    server: expressServer,
//    auth: authentication method,
//    apiRoot: “/admin/v1/cms”
// }
function CmsEngine(options) {
  if (!options)
    throw new Error("Missing options for cms engine");
  if (!options.config)
    throw new Error("Missing configuration for the database.");
  else if (!options.config.host || !options.config.port)
    throw new Error("Missing host and port for the database.");
  if (!options.server)
    throw new Error("Missing express server.");
  if (!options.auth)
    throw new Error("Missing authentication method.");
  if (!options.apiRoot && !options.apiRoot === '')
    throw new Error("Missing api root url.");
  this.config = options.config;
  if (this.config.user && this.config.password) {
    urlCouchDb = 'http://' + this.config.user + ":" + this.config.password + "@" +
      this.config.host + ":" + this.config.port; // + "/" + this.config.db;
  } else {
    urlCouchDb = 'http://' + this.config.host + ":" + this.config.port; // + "/" + this.config.db;
  }
  this.apiRoot = options.apiRoot;
  this.auth = options.auth;
  this.server = options.server;
}

CmsEngine.prototype.start = function () {
  var that = this;
  syncDesignDoc.create(this.config, function (err, db) {
    if (err)
      throw new Exception(err);
    that.db = db;
    that.addServer();
  });
};

CmsEngine.prototype.addServer = function () {
  // add urls for the express server
  var app = this.server;
  var db = this.db;
  var that = this;
  var apiRoot = this.apiRoot;
  app.use(bodyParser.json()); // support json encoded bodies
  app.use(bodyParser.urlencoded({
    extended: true
  })); // support encoded bodies

  // configure =============================================================
  app.engine('html', mustacheExpress()); // register file extension mustache
  app.set('view engine', 'html'); // register file extension for partials
  app.set('views', __dirname + '/../views');
  // app.use(express.static(__dirname + '/public')); // set static folder


  var renderPosts = function (res) {
    db.view(that.config.db, 'posts_by_date', function (err, resp) {
      if (!err) {
        var posts = resp.rows.map(function (x) {
          x.value.body = marked(x.value.body);
          return x.value;
        });
        res.render('posts', {
          head: {
            title: 'page title'
          },
          posts: posts,
          apiRoot: that.apiRoot

        });
      } else {
        res.status(500).send('Error retrieving data');
      }
    });
  };

  var renderPost = function (id, res) {
    db.get(id, function (err, resp) {
      if (!err) {
        var attachments = resp._attachments;
        resp.body = marked(resp.body);
        var files = [];
        if (attachments) {
          for (var key in attachments) {
            files.push({
              name: key,
              option: (resp.credentials[key].isPrivate ? 'Make public' : 'Make private'),
              credentials: resp.credentials[key].isPrivate
            });
          }
          resp.files = files;
          delete resp._attachments;
        }
        resp.apiRoot = apiRoot;
        res.render('post.html', resp);
      } else {
        res.status(500).send('Error retrieving data');
      }

    });
  };

  app.get(apiRoot + '/', function (req, res) {
    res.redirect(apiRoot + '/posts');
  });

  app.get(this.apiRoot + '/posts', function (req, res) {
    renderPosts(res);
    // db.view(that.config.db, 'posts_by_date', function(err, resp) {
    //   if (!err) {
    //     var posts = resp.rows.map(function(x) {
    //       x.value.body = marked(x.value.body);
    //       return x.value;
    //     });
    //     res.render('posts', {
    //       head: {
    //         title: 'page title'
    //       },
    //       posts: posts,
    //       apiRoot: that.apiRoot

    //     });
    //   } else {
    //     res.status(500).send('Error retrieving data');
    //   }

    // });
  });

  app.get(apiRoot + '/posts/new', function (req, res) {
    res.render('new-post.html', {
      head: {
        title: 'new post'
      },
      apiRoot: apiRoot
    });
  });

  app.post(apiRoot + '/posts', function (req, res) {
    var post = req.body;
    post.type = 'post';
    post.postedAt = new Date();
    post.body = post.body;
    if (req.body._id) {
      db.get(req.body._id, function (err, resp) {
        if (!err) {
          resp.title = post.title;
          resp.body = post.body;
          resp.postedAt = post.postedAt;
          db.insert(resp, function (err, resp) {
            // res.redirect(apiRoot + '/posts');
            renderPosts(res);
          });
        } else {
          res.status(500).send('Error retrieving data');
        }
      });
    } else {
      db.insert(post, function (err, resp) {
        if (!err)
        // res.redirect(apiRoot + '/posts');
          renderPosts(res);
        else
          res.status(500).send('Error retrieving data');
      });
    }


  });

  app.get(apiRoot + '/posts/:id/edit', function (req, res) {
    db.get(req.params.id, function (err, resp) {
      if (!err) {
        res.render('edit-post.html', {
          title: resp.title,
          body: resp.body,
          _rev: resp._rev,
          _id: resp._id,
          apiRoot: apiRoot
        });
      } else {
        res.status(500).send('Error retrieving data');
      }
    });
  });

  app.get(apiRoot + '/posts/:id/delete', function (req, res) {
    console.log("destroying");
    db.get(req.params.id, function (err, resp1) {
      if (!err) {
        db.destroy(req.params.id, resp1._rev, function (err, resp2) {
          if (!err) {
            renderPosts(res);
          } else {
            res.status(500).send('Error Deleting data');
          }
        });
      } else {
        res.status(500).send('Error Deleting data');
      }
    });
  });

  app.get(apiRoot + '/posts/:id', function (req, res) {
    renderPost(req.params.id, res);
  });

  app.get('/authenticate' + apiRoot + '/posts/:id/files/:filename', this.auth, function (req, res) {
    db.get(req.params.id, function (err, resp) {
      if (!err) {
        db.attachment.get(req.params.id, req.params.filename).pipe(res);
      } else {
        res.status(500).send('Error retrieving data');
      }
    });
  });

  app.get(apiRoot + '/posts/:id/files/:filename', function (req, res) {
    db.get(req.params.id, function (err, resp) {
      if (!err) {
        if (!resp.credentials[req.params.filename].isPrivate)
          db.attachment.get(req.params.id, req.params.filename).pipe(res);
        else {
          if (that.auth) {
            res.redirect('/authenticate' + req.url);
          } else {
            res.status(403).send('Access denied');
          }
        }
      } else {
        res.status(500).send('Error retrieving data');
      }
    });
  });

  app.get(apiRoot + '/posts/:id/files/:filename/credentials/:credentials', function (req, res) {
    db.get(req.params.id, function (err, resp) {
      if (!err) {
        // console.log(resp.credentials[req.params.filename].isPrivate);
        resp.credentials[req.params.filename].isPrivate = req.params.credentials === 'true' ? false : true;
        // console.log(resp.credentials[req.params.filename].isPrivate);
        db.insert(resp, function (err, r) {
          renderPost(req.params.id, res);
          // res.writeHead(303, {
          //   Connection: 'close',
          //   Location: apiRoot + '/posts/' + req.params.id
          // })
          // res.end();
        });
      } else {
        res.status(500).send('Error retrieving data');
      }
    });
  });

  app.get(apiRoot + '/posts/:id/files/:filename/delete', function (req, res) {
    db.get(req.params.id, function (err, resp) {
      if (!err) {
        db.attachment.destroy(req.params.id, req.params.filename, {
          rev: resp._rev
        }, function (err, body) {
          if (!err) {
            db.get(req.params.id, function (err, resp2) {
              delete resp2.credentials[req.params.filename];
              db.insert(resp2, function (err, r) {
                renderPost(req.params.id, res);
                // res.writeHead(303, {
                //   Connection: 'close',
                //   Location: apiRoot + '/posts/' + req.params.id
                // })
                // res.end();
              });
            });
          } else {
            res.writeHead(500, {
              Connection: 'close',
              Location: apiRoot + '/posts'
            })
            res.end();
          }
        });
      } else {
        res.status(500).send('Error retrieving data');
      }
    });
  });

  var isPrivate = false;
  var insertAttach = function(doc, fileName, mimeType, file, res){
    var cbGet = function(err, resp){
      if (err) {
        throw new Error('Error retrieving data ' + err);
      }
    };
    var cbAttach = function(err, r){
      cbGet(err, r);
      db.get(doc, function (err, resp) {
        resp.credentials = resp.credentials || {};
        resp.credentials[fileName] = {
          isPrivate: isPrivate
        };
        db.insert(resp, function (err, r) {
          renderPost(doc, res);
        });
      });
    };
    db.get(doc, { revs_info: true }, function (err, body) {
          if(err)
            cbGet(err, body);
          if(body)
            file.pipe(db.attachment.insert(doc, fileName, null, mimeType, {rev:  body._rev}, cbAttach));
          else
            file.pipe(db.attachment.insert(doc, fileName, null, mimeType, cbAttach));
    });
  };


  app.post(apiRoot + '/posts/:id/files', function (req, res) {

    var busboy = new Busboy({
      headers: req.headers
    });
    
    busboy.on('file', function (fieldname, file, filename, encoding, mimetype) {
      console.log('File [' + fieldname + ']: filename: ' + filename + ', encoding: ' + encoding + ', mimetype: ' + mimetype);
      fileName = filename;
      insertAttach(req.params.id, filename, mimetype, file, res);
    });

    busboy.on('field', function (fieldname, val, fieldnameTruncated, valTruncated) {
      console.log('Field [' + fieldname + ']: value: ' + val);
      switch(fieldname){
        case 'isPrivate':
          if (val === 'on')
            isPrivate = true;
          else
            isPrivate = false;
        break;
      }
    });

    busboy.on('finish', function () {
      console.log('Done parsing form!');
    });

    req.pipe(busboy);

  });

};


module.exports = CmsEngine;