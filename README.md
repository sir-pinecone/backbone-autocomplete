Dependencies
============
jQuery
Socket.io
Backbone.js
Underscore.js (for rendering ... will remove this dependency asap)

How to use - client side
========================Include the js and css script

Create a model that will extend the autocompleter and initialize the autocompleter.
This allows you to create search models that have different socket.io namespaces. e.g. one for user search 
and another for products.

   UserCompleterModel = window.CompleterModel.extend({
      initialize: function() {
        this.createCompleter({
          namespace: 'completer',
          field: 'name',
          path: 'user',
          resultKey: 'name',
          extraFields: ['age', 'location']
        });
      }
    });

The model above will have socket.io make requests to "completer:user" namespace. It expects the server
to query on the "name" column of your database table and return the age, location and name of the user. 
When parsing the response, "name" is considered to be the result, so it is separated out from the other attributes. 

You'll now want to create an instance of your model. It requires some options to help setup the view that is used behind the scenes. 

    this.userCompleter = new UserCompleterModel({
      completerElId: '#user_completer',
      input: 'input',
      result: '.results', 
      selection: '.selections',
      onSelect: function(data) { console.log('click', data); }
      resultTemplateId: '#user_search_result_template',
      selectionTemplateId: '#user_search_selection_template',
    });

It is expected that you will have an element to treat as the autocomplete widget. Pass the ID of that for the "completerElId" option. 
The next three options are selectors for the input element, the results container and the selection container (holds what you select). These selectors are used relative to the completerElId, so make sure they are children of that element. The containers should be either ordered or unordered lists - <ol> or </ul>

The onSelect option is an optional callback that will run when the user clicks on a result.

The autocompleter also needs two templates for rendering. Examples using jade templates:

  // results template
  <% _.each(results, function(result) { %>
  | <li id="<%= result.respId %>"><%= result.result %></li>
  <% }); %>

  // selection template
  | <li data-age="<%= data.extra.age %>"><%= data.result %></li>

Finally, you must tell the auto completer to create itself. This is done with a trigger call like so:
  
      this.userCompleter.trigger('create');

The reason I added this is because the containers I want to use for selections and results are not in the DOM when the auto completer is initialized. That means the auto completer view cannot bind to anything. So I call the trigger just before the auto completer is shown for the first time, which gaurantees that everything is in the DOM. This is not ideal, but I'm not exactly sure how to get around this.

How to use - server side 
========================
I'm using Node.js with socket.io to communicate with the client code and Mongodb as the data store. Using the example above, you would listen for socket messages like so:

  io.sockets.on('connection', function(socket) {

    socket.on('completer:user', function(data) {
      console.log('Searching for user with name: ' + data.text, 'attrs', data.attrs);
      var query = {};
      query[data.field] = { $regex: new RegExp(data.text, 'i') };
      
      models.User.find(query, data.attrs, function(err, users) {
        var msg = {
          err: err,
          result: users
        };
        socket.emit('completer:user:result', msg);
      });
    });

Always send your response with ":result" tagged at the end of your socket path. 

What this still needs
=====================
* General code cleanup. I'm still thinking about a better design to get around the issue of binding to non-existing DOM elements (see above paragraph). 
* Keyboard control - use the arrow keys to select results. Better handling of special characters.
* Ability to show result info such as total # of matches, pagination, etc.
* Extend the socket namespace to allow methods as well instead of locking it down to a namespace and path. This will allow more functionality, such as pagination. E.g. right now you make calls to "completer:user" to search for users. Instead it would be "completer:user:search" and pagination could use "completer:user:more" ... something like that.
* Allow more callbacks to extend the functionality.
* Perhaps make the templates and the container elements optional and just create them from scratch in the auto completer view.
