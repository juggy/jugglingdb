## About

JugglingDB is cross-db ORM, providing **common interface** to access most popular database formats. 
Currently supported are: mysql, mongodb, redis, neo4j and js-memory-storage (yep, 
self-written engine for test-usage only). You can add your favorite database adapter, checkout one of the 
existing adapters to learn how, it's super-easy, I guarantee.

## Installation

    git clone git://github.com/1602/jugglingdb.git

## Usage

```javascript
var Schema = require('./jugglingdb').Schema;
var s = new Schema('redis');
// define models
var Post = schema.define('Post', {
    title:     { type: String, length: 255 },
    content:   { type: Schema.Text },
    date:      { type: Date,    default: Date.now },
    published: { type: Boolean, default: false }
});
// simplier way to describe model
var User = schema.define('User', {
    name:         String,
    bio:          Schema.Text,
    approved:     Boolean,
    joinedAt:     Date,
    age:          Number
});

// setup relationships
User.hasMany(Post,   {as: 'posts',  foreignKey: 'userId'});
// creates instance methods:
// user.posts(conds)
// user.posts.build(data) // like new Post({userId: user.id});
// user.posts.create(data) // build and save

Post.belongsTo(User, {as: 'author', foreignKey: 'userId'});
// creates instance methods:
// post.author(callback) -- getter when called with function
// post.author() -- sync getter when called without params
// post.author(user) -- setter when called with object

s.automigrate(); // required only for mysql NOTE: it will drop User and Post tables

// work with models:
var user = new User;
user.save(function (err) {
    var post = user.posts.build({title: 'Hello world'});
    post.save(console.log);
});

// Common API methods

// just instantiate model
new Post
// save model (of course async)
Post.create(cb);
// all posts
Post.all(cb)
// all posts by user
Post.all({where: {userId: user.id}});
// the same as prev
user.posts(cb)
// same as new Post({userId: user.id});
user.posts.build
// save as Post.create({userId: user.id}, cb);
user.posts.create(cb)
// find instance by id
User.find(1, cb)
// count instances
User.count(cb)
// destroy instance
user.destroy(cb);
// destroy all instances
User.destroyAll(cb);

// Setup validations
User.validatesPresenceOf('name', 'email')
User.validatesLengthOf('password', {min: 5, message: {min: 'Password is too short'}});
User.validatesInclusionOf('gender', {in: ['male', 'female']});
User.validatesExclusionOf('domain', {in: ['www', 'billing', 'admin']});
User.validatesNumericalityOf('age', {int: true});
User.validatesUniquenessOf('email', {message: 'email is not unique'});

user.isValid(function (valid) {
    if (!valid) {
        user.errors // hash of errors {attr: [errmessage, errmessage, ...], attr: ...}    
    }
})

```

## Callbacks

The following callbacks supported:

    - afterInitialize
    - beforeCreate
    - afterCreate
    - beforeSave
    - afterSave
    - beforeUpdate
    - afterUpdate
    - beforeDestroy
    - afterDestroy
    - beforeValidation
    - afterValidation

Each callback is class method of the model, it should accept single argument: `next`, this is callback which
should be called after end of the hook. Except `afterInitialize` because this method is syncronous (called after `new Model`).

## Object lifecycle:

```javascript
var user = new User;
// afterInitialize
user.save(callback);
// beforeValidation
// afterValidation
// beforeSave
// beforeCreate
// afterCreate
// afterSave
// callback
user.updateAttribute('email', 'email@example.com', callback);
// beforeValidation
// afterValidation
// beforeUpdate
// afterUpdate
// callback
user.destroy(callback);
// beforeDestroy
// afterDestroy
// callback
User.create(data, callback);
// beforeValidate
// afterValidate
// beforeCreate
// afterCreate
// callback
```

Read the tests for usage examples: ./test/common_test.js
Validations: ./test/validations_test.js

## Your own database adapter

To use custom adapter, pass it's package name as first argument to `Schema` constructor:

    mySchema = new Schema('couch-db-adapter', {host:.., port:...});

Make sure, your adapter can be required (just put it into ./node_modules):

    require('couch-db-adapter');

## Running tests

All tests are written using nodeunit:

    nodeunit test/common_test.js

If you run this line, of course it will fall, because it requres different databases to be up and running, 
but you can use js-memory-engine out of box! Specify ONLY env var:

    ONLY=memory nodeunit test/common_test.js

of course, if you have redis running, you can run

    ONLY=redis nodeunit test/common_test.js

## Package structure

Now all common logic described in `./lib/*.js`, and database-specific stuff in `./lib/adapters/*.js`. It's super-tiny, right?

## Project status

This project was written in one weekend (1,2 oct 2011), and of course does not claim to be production-ready,
but I plan to use this project as default ORM for RailwayJS in nearest future.
So, if you are familiar with some database engines - please help me to improve adapter for that database.

For example, I know, mysql implementation sucks now, 'cause I'm not digging too deep into SequelizeJS code,
and I think it would be better to replace sequelize with something low-level in nearest future, such
as `mysql` package from npm.

## Contributing

If you have found a bug please write unit test, and make sure all other tests still pass before pushing code to repo.

## Roadmap

### Common:

+ transparent interface to APIs
+ -before and -after hooks on save, update, destroy
+ scopes
+ default values
+ more relationships stuff
+ docs

### Databases:

+ riak
+ couchdb
+ low-level mysql
+ postgres
+ sqlite

## License

MIT
