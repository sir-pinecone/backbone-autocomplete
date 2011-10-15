/* Author:
 * Michael Campagnaro
*/

(function($) {
  function idGenerator() {
    var S4 = function() {
       return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
    };
    return (S4()+S4()+S4()+S4());
  } 
  
  // TODO: might be best to just incorporate the autocomplete object into this model
  window.CompleterModel = Backbone.Model.extend({

    initialize:function() { 
      _.bindAll(this, '_onResponse');
    },

    createCompleter: function(options) {
      this.set({ 'completerResults': [], 'completerSelections': [] });
      var opts = { 
          model: this 
        , field: options.field
        , path: options.path
        , namespace: options.namespace
        , resultKey: options.resultKey
        , extraFields: options.extraFields
      };
      this.completer = new ServerAutoCompleter(opts, this);
      this.completerView = new CompleterView({ model: this });
      this.completer.bind('result', this._onResponse); 
    },

    search: function(text) {
      this.completer.search(text);
    },

    clearSelections: function() {
      this.set({ 'completerSelections': [] });
    },
                 
    saveSelection: function(data) {
      var selections = this.get('completerSelections');
      selections.push(data);
      this.set({ 'completerSelections': selections });
    },

    getSelections: function() {
      return this.get('completerSelections');
    },

    _onResponse: function(resp) {
      console.log('got response!');
      this.set({ 'completerResults': resp.result });
    }
  });

  /* Params:
   * options {
   *  socket - an instance of socket.io
   *  resultKey - the name of the result attribute that should be considered as 
   *    the result. It will be marked as so.
   *  field - what to query on server side. e.g. "user_id"
   *  extraFields - array of field names to include in the response object
   *  namespace - socket.io namespace for the server. Defaults to "completer"
   * }
   */
  function ServerAutoCompleter(options) {
    this.options = options || {};

    this.model = options.model || null;
    this.socket = window.socket || this.options.socket;

    this.resultKey = this.options.resultKey;
    this.field = this.options.field;
    this.extraFields = this.options.extraFields;
    var namespace = this.options.namespace || 'completer';
    this.url = namespace + ':' + this.options.path;
  };

  /* Parses the response data and formats it for the view.
   * Returns an array of objects. Each object contains a unique ID, 
   * the result value and the extra field values in another object.
   */
  ServerAutoCompleter.prototype._createResponse = function(data) {
    if (!data.length) return [];

    var ret = []
    var self = this;

    // prepare the result data
    _.each(data, function(entry) {
      var newEntry = { 
        respId: idGenerator(), // each response gets a unique id 
        result: entry[self.resultKey], 
        extra: {} 
      };

      // change the id name if this is from mondodb (and couchdb?)
      newEntry.extra.id = entry._id || null;

      // extract the extra fields values
      _.each(self.extraFields, function(extraKey) {
        newEntry.extra[extraKey] = entry[extraKey];
      });

      ret.push(newEntry);
    });
  
    return ret;
  };

  /* Used by the model to bind to socket messages. E.g. pass 'result' to catch
   * all result messages from the server.
   */
  ServerAutoCompleter.prototype.bind = function(eventName, callback) {
    var context = this.model;
    var socketName = this.url + ':' + eventName;
    var self = this;
    var event = {
        name: eventName
      , socketName: socketName
      , cbLocal: callback
      , cbSocket: function(data) {
          result = self._createResponse(data.result);
          var ret = { err: data.err, result: result };
          context.trigger(eventName, ret);
        } 
    };
    // create a bind on the model so that it can be triggered when a response comes
    context.bind(event.name, event.cbLocal, context);
    this.socket.on(event.socketName, event.cbSocket);
  };

  /* Sends the search message to the server. Pass in the text to search for */
  ServerAutoCompleter.prototype.search = function(text) {
    var attrs = this.extraFields.slice();
    attrs.push(this.resultKey);
    // send the message
    this.socket.emit(this.url, { 
      field: this.field, 
      text: text, 
      attrs: attrs
    });
  };

  // ----------------------------------------------------
  // TODO: add an info result to the result list.
  //       Can be used to show total # of results, pagination, etc. 
  CompleterView = Backbone.View.extend({
    initialize: function() {
      _.bindAll(this, 'searchKeydown', 'onSelect', 'onBlur', '_bindElements');
      this.model.bind('create', this._bindElements, this);
      this.model.bind('change:completerSelections', this.clearSelections, this);
      
      this.created = false;
      this.completerElId = this.model.get('completerElId');
      this.resultTemplate = _.template($(this.model.get('resultTemplateId')).html());
      this.selectionTemplate = _.template($(this.model.get('selectionTemplateId')).html());
      this.onSelectCallback = this.model.get('onSelect') || function(){};
    },

    /* Called by the 'create' trigger. Binds to the various elements. It is 
     * expected that the elements exist in the DOM when this function is called.
     */
    _bindElements: function() {
      // TODO: come up with a better way to handle binding to elements that 
      // may not exist yet. It's pretty lame that you have to trigger this event
      // from the parent.
      if (!this.created) {
        $(this.completerElId).addClass(this.model.get('classname') || 'completer');
        this.inputEl = $(this.model.get('input'), this.completerElId);
        this.resultEl = $(this.model.get('result'), this.completerElId);
        this.selectionEl = $(this.model.get('selection'), this.completerElId);

        this.model.bind('change:completerResults', this.render, this);
        this.inputEl.bind('keydown', this.searchKeydown);
        this.resultEl.delegate('li', 'click', this.onSelect);
        this.inputEl.bind('blur', this.onBlur);
        this.created = true;
      }
    },

    render: function() {
      if (!this.model.get('completerResults').length) {
        this.clearResults();
        return;
      }
      var results = this.model.get('completerResults');
      this.resultEl.html(this.resultTemplate({ results: results }));
      this.resultEl.fadeIn('fast');
      return this;
    },

    onBlur: function() {
      var self = this;
      setTimeout(function() {
        self.inputEl.val('');
        self.clearResults();
      }, 200);
    },

    keyCodes: {
      8: 'delete',
      13: 'enter',
      32: 'space'
    },

    searchKeydown: function() {
      var keyPressed = event.which;
      if (!this.checkForControlCharacter(keyPressed)) return;
      
      var text = this.getSearchText(keyPressed);

      if (text.length === 0) {
        this.clearResults();
      }
      else {
        this.model.search(text);
      }
    },

    checkForControlCharacter: function(code) {
      // TODO: might be better to use event handlers instead of if statements
      // need keyboard control to highlight result options. need better way to
      // handle valid key codes.
      var minAlpha = 65,
          maxAlpha = 90,
          minNum = 48,
          maxNum = 57,
          keyName = this.keyCodes[code];

      if (keyName === 'delete' || keyName === 'space') {
        return true;
      }
      else if ( (code < minAlpha || code > maxAlpha) && (code < minNum || code > maxNum) ) {
        return false;
      }
      else if (keyName === 'enter') {
        return false;
      }
      return true;
    },

    clearResults: function() {
      var self = this;
      $(self.resultEl).hide('fast', function() {
        self.resultEl.empty();
      });
      this.model.set({ 'completerResults': [] });
    },

    clearSelections: function() {
      console.log('clear selections');
      this.selectionEl.empty();
    },

    getSearchText: function(code) {
      var text = this.inputEl.val();
      if (this.keyCodes[code] === 'delete') {
        text = text.slice(0, -1);
      }
      else {
        text += String.fromCharCode(code).toLowerCase();
      }
      return text;
    },

    onSelect: function(e) {
      var id = e.target.id;
      // get the result data for the clicked row
      var data = _.detect(this.model.get('completerResults'), 
        function(d) { 
          return d.respId === id; 
      });
    
      this.clearResults();
      this.model.saveSelection(data);
      this.selectionEl.append(this.selectionTemplate({ data: data }));
      this.onSelectCallback(data);
    },
  });
})(jQuery);

