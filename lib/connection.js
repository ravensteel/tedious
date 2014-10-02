// Generated by CoffeeScript 1.7.1
var BulkLoad, Connection, ConnectionError, DEFAULT_CANCEL_TIMEOUT, DEFAULT_CLIENT_REQUEST_TIMEOUT, DEFAULT_CONNECT_TIMEOUT, DEFAULT_PACKET_SIZE, DEFAULT_PORT, DEFAULT_TDS_VERSION, DEFAULT_TEXTSIZE, Debug, EventEmitter, ISOLATION_LEVEL, KEEP_ALIVE_INITIAL_DELAY, Login7Payload, MessageIO, NTLMResponsePayload, PreloginPayload, Request, RequestError, RpcRequestPayload, Socket, SqlBatchPayload, TYPE, TokenStreamParser, Transaction, crypto, instanceLookup, tls, _ref,
  __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  __slice = [].slice;

require('./buffertools');

BulkLoad = require('./bulk-load');

Debug = require('./debug');

EventEmitter = require('events').EventEmitter;

instanceLookup = require('./instance-lookup').instanceLookup;

TYPE = require('./packet').TYPE;

PreloginPayload = require('./prelogin-payload');

Login7Payload = require('./login7-payload');

NTLMResponsePayload = require('./ntlm-payload');

Request = require('./request');

RpcRequestPayload = require('./rpcrequest-payload');

SqlBatchPayload = require('./sqlbatch-payload');

MessageIO = require('./message-io');

Socket = require('net').Socket;

TokenStreamParser = require('./token/token-stream-parser').Parser;

Transaction = require('./transaction').Transaction;

ISOLATION_LEVEL = require('./transaction').ISOLATION_LEVEL;

crypto = require('crypto');

tls = require('tls');

_ref = require('./errors'), ConnectionError = _ref.ConnectionError, RequestError = _ref.RequestError;

KEEP_ALIVE_INITIAL_DELAY = 30 * 1000;

DEFAULT_CONNECT_TIMEOUT = 15 * 1000;

DEFAULT_CLIENT_REQUEST_TIMEOUT = 15 * 1000;

DEFAULT_CANCEL_TIMEOUT = 5 * 1000;

DEFAULT_PACKET_SIZE = 4 * 1024;

DEFAULT_TEXTSIZE = '2147483647';

DEFAULT_PORT = 1433;

DEFAULT_TDS_VERSION = '7_4';

Connection = (function(_super) {
  __extends(Connection, _super);

  Connection.prototype.STATE = {
    CONNECTING: {
      name: 'Connecting',
      enter: function() {
        return this.initialiseConnection();
      },
      events: {
        socketError: function(error) {
          return this.transitionTo(this.STATE.FINAL);
        },
        connectTimeout: function() {
          return this.transitionTo(this.STATE.FINAL);
        },
        socketConnect: function() {
          this.sendPreLogin();
          return this.transitionTo(this.STATE.SENT_PRELOGIN);
        }
      }
    },
    SENT_PRELOGIN: {
      name: 'SentPrelogin',
      enter: function() {
        return this.emptyMessageBuffer();
      },
      events: {
        socketError: function(error) {
          return this.transitionTo(this.STATE.FINAL);
        },
        connectTimeout: function() {
          return this.transitionTo(this.STATE.FINAL);
        },
        data: function(data) {
          return this.addToMessageBuffer(data);
        },
        message: function() {
          return this.processPreLoginResponse();
        },
        noTls: function() {
          this.sendLogin7Packet();
          if (this.config.domain) {
            return this.transitionTo(this.STATE.SENT_LOGIN7_WITH_NTLM);
          } else {
            return this.transitionTo(this.STATE.SENT_LOGIN7_WITH_STANDARD_LOGIN);
          }
        },
        tls: function() {
          this.initiateTlsSslHandshake();
          this.sendLogin7Packet();
          return this.transitionTo(this.STATE.SENT_TLSSSLNEGOTIATION);
        }
      }
    },
    REROUTING: {
      name: 'ReRouting',
      enter: function() {
        return this.cleanupConnection();
      },
      events: {
        message: function() {},
        socketError: function(error) {
          return this.transitionTo(this.STATE.FINAL);
        },
        connectTimeout: function() {
          return this.transitionTo(this.STATE.FINAL);
        },
        reconnect: function() {
          this.config.server = this.routingData.server;
          this.config.options.port = this.routingData.port;
          return this.transitionTo(this.STATE.CONNECTING);
        }
      }
    },
    SENT_TLSSSLNEGOTIATION: {
      name: 'SentTLSSSLNegotiation',
      enter: function() {},
      events: {
        socketError: function(error) {
          return this.transitionTo(this.STATE.FINAL);
        },
        connectTimeout: function() {
          return this.transitionTo(this.STATE.FINAL);
        },
        data: function(data) {
          return this.securePair.encrypted.write(data);
        },
        tlsNegotiated: function() {
          return this.tlsNegotiationComplete = true;
        },
        message: function() {
          if (this.tlsNegotiationComplete) {
            return this.transitionTo(this.STATE.SENT_LOGIN7_WITH_STANDARD_LOGIN);
          } else {

          }
        }
      }
    },
    SENT_LOGIN7_WITH_STANDARD_LOGIN: {
      name: 'SentLogin7WithStandardLogin',
      events: {
        socketError: function(error) {
          return this.transitionTo(this.STATE.FINAL);
        },
        connectTimeout: function() {
          return this.transitionTo(this.STATE.FINAL);
        },
        data: function(data) {
          return this.sendDataToTokenStreamParser(data);
        },
        loggedIn: function() {
          return this.transitionTo(this.STATE.LOGGED_IN_SENDING_INITIAL_SQL);
        },
        routingChange: function() {
          return this.transitionTo(this.STATE.REROUTING);
        },
        loginFailed: function() {
          return this.transitionTo(this.STATE.FINAL);
        },
        message: function() {
          return this.processLogin7Response();
        }
      }
    },
    SENT_LOGIN7_WITH_NTLM: {
      name: 'SentLogin7WithNTLMLogin',
      events: {
        socketError: function(error) {
          return this.transitionTo(this.STATE.FINAL);
        },
        connectTimeout: function() {
          return this.transitionTo(this.STATE.FINAL);
        },
        data: function(data) {
          return this.sendDataToTokenStreamParser(data);
        },
        receivedChallenge: function() {
          this.sendNTLMResponsePacket();
          return this.transitionTo(this.STATE.SENT_NTLM_RESPONSE);
        },
        loginFailed: function() {
          return this.transitionTo(this.STATE.FINAL);
        },
        message: function() {
          return this.processLogin7NTLMResponse();
        }
      }
    },
    SENT_NTLM_RESPONSE: {
      name: 'SentNTLMResponse',
      events: {
        socketError: function(error) {
          return this.transitionTo(this.STATE.FINAL);
        },
        connectTimeout: function() {
          return this.transitionTo(this.STATE.FINAL);
        },
        data: function(data) {
          return this.sendDataToTokenStreamParser(data);
        },
        loggedIn: function() {
          return this.transitionTo(this.STATE.LOGGED_IN_SENDING_INITIAL_SQL);
        },
        loginFailed: function() {
          return this.transitionTo(this.STATE.FINAL);
        },
        routingChange: function() {
          return this.transitionTo(this.STATE.REROUTING);
        },
        message: function() {
          return this.processLogin7NTLMAck();
        }
      }
    },
    LOGGED_IN_SENDING_INITIAL_SQL: {
      name: 'LoggedInSendingInitialSql',
      enter: function() {
        return this.sendInitialSql();
      },
      events: {
        connectTimeout: function() {
          return this.transitionTo(this.STATE.FINAL);
        },
        data: function(data) {
          return this.sendDataToTokenStreamParser(data);
        },
        message: function(error) {
          this.transitionTo(this.STATE.LOGGED_IN);
          return this.processedInitialSql();
        }
      }
    },
    LOGGED_IN: {
      name: 'LoggedIn',
      events: {
        socketError: function(error) {
          return this.transitionTo(this.STATE.FINAL);
        }
      }
    },
    SENT_CLIENT_REQUEST: {
      name: 'SentClientRequest',
      events: {
        socketError: function(error) {
          return this.transitionTo(this.STATE.FINAL);
        },
        data: function(data) {
          return this.sendDataToTokenStreamParser(data);
        },
        message: function() {
          var sqlRequest;
          this.clearRequestTimer();
          this.transitionTo(this.STATE.LOGGED_IN);
          sqlRequest = this.request;
          this.request = void 0;
          return sqlRequest.callback(sqlRequest.error, sqlRequest.rowCount, sqlRequest.rows);
        }
      }
    },
    SENT_ATTENTION: {
      name: 'SentAttention',
      enter: function() {
        return this.attentionReceived = false;
      },
      events: {
        socketError: function(error) {
          return this.transitionTo(this.STATE.FINAL);
        },
        data: function(data) {
          return this.sendDataToTokenStreamParser(data);
        },
        attention: function() {
          return this.attentionReceived = true;
        },
        message: function() {
          var message, sqlRequest;
          if (this.attentionReceived) {
            sqlRequest = this.request;
            this.request = void 0;
            this.transitionTo(this.STATE.LOGGED_IN);
            if (sqlRequest.canceled) {
              return sqlRequest.callback(RequestError("Canceled.", 'ECANCEL'));
            } else {
              message = "Timeout: Request failed to complete in " + this.config.options.requestTimeout + "ms";
              return sqlRequest.callback(RequestError(message, 'ETIMEOUT'));
            }
          }
        }
      }
    },
    FINAL: {
      name: 'Final',
      enter: function() {
        return this.cleanupConnection();
      },
      events: {
        loginFailed: function() {},
        connectTimeout: function() {},
        message: function() {},
        socketError: function() {}
      }
    }
  };

  function Connection(config) {
    this.config = config;
    this.reset = __bind(this.reset, this);
    this.socketClose = __bind(this.socketClose, this);
    this.socketEnd = __bind(this.socketEnd, this);
    this.socketConnect = __bind(this.socketConnect, this);
    this.socketError = __bind(this.socketError, this);
    this.requestTimeout = __bind(this.requestTimeout, this);
    this.connectTimeout = __bind(this.connectTimeout, this);
    this.defaultConfig();
    this.createDebug();
    this.createTokenStreamParser();
    this.transactions = [];
    this.transactionDescriptors = [new Buffer([0, 0, 0, 0, 0, 0, 0, 0])];
    this.transitionTo(this.STATE.CONNECTING);
  }

  Connection.prototype.close = function() {
    return this.transitionTo(this.STATE.FINAL);
  };

  Connection.prototype.initialiseConnection = function() {
    this.connect();
    return this.createConnectTimer();
  };

  Connection.prototype.cleanupConnection = function() {
    if (!this.closed) {
      this.clearConnectTimer();
      this.clearRequestTimer();
      this.closeConnection();
      this.emit('end');
      this.closed = true;
      this.loggedIn = false;
      return this.loginError = null;
    }
  };

  Connection.prototype.defaultConfig = function() {
    var _base, _base1, _base10, _base11, _base12, _base13, _base2, _base3, _base4, _base5, _base6, _base7, _base8, _base9;
    (_base = this.config).options || (_base.options = {});
    (_base1 = this.config.options).textsize || (_base1.textsize = DEFAULT_TEXTSIZE);
    (_base2 = this.config.options).connectTimeout || (_base2.connectTimeout = DEFAULT_CONNECT_TIMEOUT);
    (_base3 = this.config.options).requestTimeout || (_base3.requestTimeout = DEFAULT_CLIENT_REQUEST_TIMEOUT);
    (_base4 = this.config.options).cancelTimeout || (_base4.cancelTimeout = DEFAULT_CANCEL_TIMEOUT);
    (_base5 = this.config.options).packetSize || (_base5.packetSize = DEFAULT_PACKET_SIZE);
    (_base6 = this.config.options).tdsVersion || (_base6.tdsVersion = DEFAULT_TDS_VERSION);
    (_base7 = this.config.options).isolationLevel || (_base7.isolationLevel = ISOLATION_LEVEL.READ_COMMITTED);
    (_base8 = this.config.options).encrypt || (_base8.encrypt = false);
    (_base9 = this.config.options).cryptoCredentialsDetails || (_base9.cryptoCredentialsDetails = {});
    if ((_base10 = this.config.options).useUTC == null) {
      _base10.useUTC = true;
    }
    if ((_base11 = this.config.options).useColumnNames == null) {
      _base11.useColumnNames = false;
    }
    (_base12 = this.config.options).connectionIsolationLevel || (_base12.connectionIsolationLevel = ISOLATION_LEVEL.READ_COMMITTED);
    if ((_base13 = this.config.options).readOnlyIntent == null) {
      _base13.readOnlyIntent = false;
    }
    if (!this.config.options.port && !this.config.options.instanceName) {
      return this.config.options.port = DEFAULT_PORT;
    } else if (this.config.options.port && this.config.options.instanceName) {
      throw new Error("Port and instanceName are mutually exclusive, but " + this.config.options.port + " and " + this.config.options.instanceName + " provided");
    } else if (this.config.options.port) {
      if (this.config.options.port < 0 || this.config.options.port > 65536) {
        throw new RangeError("Port should be > 0 and < 65536");
      }
    }
  };

  Connection.prototype.createDebug = function() {
    this.debug = new Debug(this.config.options.debug);
    return this.debug.on('debug', (function(_this) {
      return function(message) {
        return _this.emit('debug', message);
      };
    })(this));
  };

  Connection.prototype.createTokenStreamParser = function() {
    this.tokenStreamParser = new TokenStreamParser(this.debug, void 0, this.config.options);
    this.tokenStreamParser.on('infoMessage', (function(_this) {
      return function(token) {
        return _this.emit('infoMessage', token);
      };
    })(this));
    this.tokenStreamParser.on('sspichallenge', (function(_this) {
      return function(token) {
        if (token.ntlmpacket) {
          _this.ntlmpacket = token.ntlmpacket;
        }
        return _this.emit('sspichallenge', token);
      };
    })(this));
    this.tokenStreamParser.on('errorMessage', (function(_this) {
      return function(token) {
        _this.emit('errorMessage', token);
        if (_this.loggedIn) {
          if (_this.request) {
            return _this.request.error = RequestError(token.message, 'EREQUEST');
          }
        } else {
          return _this.loginError = ConnectionError(token.message, 'ELOGIN');
        }
      };
    })(this));
    this.tokenStreamParser.on('databaseChange', (function(_this) {
      return function(token) {
        return _this.emit('databaseChange', token.newValue);
      };
    })(this));
    this.tokenStreamParser.on('languageChange', (function(_this) {
      return function(token) {
        return _this.emit('languageChange', token.newValue);
      };
    })(this));
    this.tokenStreamParser.on('charsetChange', (function(_this) {
      return function(token) {
        return _this.emit('charsetChange', token.newValue);
      };
    })(this));
    this.tokenStreamParser.on('loginack', (function(_this) {
      return function(token) {
        if (!token.tdsVersion) {
          _this.loginError = ConnectionError("Server responded with unknown TDS version.", 'ETDS');
          _this.loggedIn = false;
          return;
        }
        if (!token["interface"]) {
          _this.loginError = ConnectionError("Server responded with unsupported interface.", 'EINTERFACENOTSUPP');
          _this.loggedIn = false;
          return;
        }
        _this.config.options.tdsVersion = token.tdsVersion;
        return _this.loggedIn = true;
      };
    })(this));
    this.tokenStreamParser.on('routingChange', (function(_this) {
      return function(token) {
        _this.routingData = token.newValue;
        return _this.dispatchEvent('routingChange');
      };
    })(this));
    this.tokenStreamParser.on('packetSizeChange', (function(_this) {
      return function(token) {
        return _this.messageIo.packetSize(token.newValue);
      };
    })(this));
    this.tokenStreamParser.on('beginTransaction', (function(_this) {
      return function(token) {
        return _this.transactionDescriptors.push(token.newValue);
      };
    })(this));
    this.tokenStreamParser.on('commitTransaction', (function(_this) {
      return function(token) {
        return _this.transactionDescriptors.pop();
      };
    })(this));
    this.tokenStreamParser.on('rollbackTransaction', (function(_this) {
      return function(token) {
        return _this.transactionDescriptors.pop();
      };
    })(this));
    this.tokenStreamParser.on('columnMetadata', (function(_this) {
      return function(token) {
        var col, columns, _i, _len, _ref1;
        if (_this.request) {
          if (_this.config.options.useColumnNames) {
            columns = {};
            _ref1 = token.columns;
            for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
              col = _ref1[_i];
              if (columns[col.colName] == null) {
                columns[col.colName] = col;
              }
            }
          } else {
            columns = token.columns;
          }
          return _this.request.emit('columnMetadata', columns);
        } else {
          _this.emit('error', new Error("Received 'columnMetadata' when no sqlRequest is in progress"));
          return _this.close();
        }
      };
    })(this));
    this.tokenStreamParser.on('order', (function(_this) {
      return function(token) {
        if (_this.request) {
          return _this.request.emit('order', token.orderColumns);
        } else {
          _this.emit('error', new Error("Received 'order' when no sqlRequest is in progress"));
          return _this.close();
        }
      };
    })(this));
    this.tokenStreamParser.on('row', (function(_this) {
      return function(token) {
        if (_this.request) {
          if (_this.config.options.rowCollectionOnRequestCompletion || _this.config.options.rowCollectionOnDone) {
            _this.request.rows.push(token.columns);
          }
          return _this.request.emit('row', token.columns);
        } else {
          _this.emit('error', new Error("Received 'row' when no sqlRequest is in progress"));
          return _this.close();
        }
      };
    })(this));
    this.tokenStreamParser.on('returnStatus', (function(_this) {
      return function(token) {
        if (_this.request) {
          return _this.procReturnStatusValue = token.value;
        }
      };
    })(this));
    this.tokenStreamParser.on('returnValue', (function(_this) {
      return function(token) {
        if (_this.request) {
          return _this.request.emit('returnValue', token.paramName, token.value, token.metadata);
        }
      };
    })(this));
    this.tokenStreamParser.on('doneProc', (function(_this) {
      return function(token) {
        if (_this.request) {
          _this.request.emit('doneProc', token.rowCount, token.more, _this.procReturnStatusValue, _this.request.rows);
          _this.procReturnStatusValue = void 0;
          if (token.rowCount !== void 0) {
            _this.request.rowCount += token.rowCount;
          }
          if (_this.config.options.rowCollectionOnDone) {
            return _this.request.rows = [];
          }
        }
      };
    })(this));
    this.tokenStreamParser.on('doneInProc', (function(_this) {
      return function(token) {
        if (_this.request) {
          _this.request.emit('doneInProc', token.rowCount, token.more, _this.request.rows);
          if (token.rowCount !== void 0) {
            _this.request.rowCount += token.rowCount;
          }
          if (_this.config.options.rowCollectionOnDone) {
            return _this.request.rows = [];
          }
        }
      };
    })(this));
    this.tokenStreamParser.on('done', (function(_this) {
      return function(token) {
        if (_this.request) {
          if (token.attention) {
            _this.dispatchEvent("attention");
          }
          if (token.sqlError && !_this.request.error) {
            _this.request.error = RequestError('An unknown error has occurred.', 'UNKNOWN');
          }
          _this.request.emit('done', token.rowCount, token.more, _this.request.rows);
          if (token.rowCount !== void 0) {
            _this.request.rowCount += token.rowCount;
          }
          if (_this.config.options.rowCollectionOnDone) {
            return _this.request.rows = [];
          }
        }
      };
    })(this));
    this.tokenStreamParser.on('resetConnection', (function(_this) {
      return function(token) {
        return _this.emit('resetConnection');
      };
    })(this));
    return this.tokenStreamParser.on('tokenStreamError', (function(_this) {
      return function(error) {
        _this.emit('error', error);
        return _this.close();
      };
    })(this));
  };

  Connection.prototype.connect = function() {
    if (this.config.options.port) {
      return this.connectOnPort(this.config.options.port);
    } else {
      return instanceLookup(this.config.server, this.config.options.instanceName, (function(_this) {
        return function(message, port) {
          if (message) {
            return _this.emit('connect', ConnectionError(message, 'EINSTLOOKUP'));
          } else {
            return _this.connectOnPort(port);
          }
        };
      })(this), this.config.options.connectTimeout);
    }
  };

  Connection.prototype.connectOnPort = function(port) {
    var connectOpts;
    this.socket = new Socket({});
    connectOpts = {
      host: this.config.server,
      port: port
    };
    if (this.config.options.localAddress) {
      connectOpts.localAddress = this.config.options.localAddress;
    }
    this.socket.connect(connectOpts);
    this.socket.on('error', this.socketError);
    this.socket.on('connect', this.socketConnect);
    this.socket.on('close', this.socketClose);
    this.socket.on('end', this.socketEnd);
    this.messageIo = new MessageIO(this.socket, this.config.options.packetSize, this.debug);
    this.messageIo.on('data', (function(_this) {
      return function(data) {
        return _this.dispatchEvent('data', data);
      };
    })(this));
    return this.messageIo.on('message', (function(_this) {
      return function() {
        return _this.dispatchEvent('message');
      };
    })(this));
  };

  Connection.prototype.closeConnection = function() {
    var _ref1;
    return (_ref1 = this.socket) != null ? _ref1.destroy() : void 0;
  };

  Connection.prototype.createConnectTimer = function() {
    return this.connectTimer = setTimeout(this.connectTimeout, this.config.options.connectTimeout);
  };

  Connection.prototype.createRequestTimer = function() {
    if (this.config.options.requestTimeout) {
      return this.requestTimer = setTimeout(this.requestTimeout, this.config.options.requestTimeout);
    }
  };

  Connection.prototype.connectTimeout = function() {
    var message;
    message = "Failed to connect to " + this.config.server + ":" + this.config.options.port + " in " + this.config.options.connectTimeout + "ms";
    this.debug.log(message);
    this.emit('connect', ConnectionError(message, 'ETIMEOUT'));
    this.connectTimer = void 0;
    return this.dispatchEvent('connectTimeout');
  };

  Connection.prototype.requestTimeout = function() {
    this.requestTimer = void 0;
    this.messageIo.sendMessage(TYPE.ATTENTION);
    return this.transitionTo(this.STATE.SENT_ATTENTION);
  };

  Connection.prototype.clearConnectTimer = function() {
    if (this.connectTimer) {
      return clearTimeout(this.connectTimer);
    }
  };

  Connection.prototype.clearRequestTimer = function() {
    if (this.requestTimer) {
      return clearTimeout(this.requestTimer);
    }
  };

  Connection.prototype.transitionTo = function(newState) {
    var _ref1, _ref2;
    if (this.state === newState) {
      this.debug.log("State is already " + newState.name);
      return;
    }
    if ((_ref1 = this.state) != null ? _ref1.exit : void 0) {
      this.state.exit.apply(this);
    }
    this.debug.log("State change: " + ((_ref2 = this.state) != null ? _ref2.name : void 0) + " -> " + newState.name);
    this.state = newState;
    if (this.state.enter) {
      return this.state.enter.apply(this);
    }
  };

  Connection.prototype.dispatchEvent = function() {
    var args, eventFunction, eventName, _ref1;
    eventName = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
    if ((_ref1 = this.state) != null ? _ref1.events[eventName] : void 0) {
      return eventFunction = this.state.events[eventName].apply(this, args);
    } else {
      this.emit('error', new Error("No event '" + eventName + "' in state '" + this.state.name + "'"));
      return this.close();
    }
  };

  Connection.prototype.socketError = function(error) {
    var message;
    message = "Failed to connect to " + this.config.server + ":" + this.config.options.port + " - " + error.message;
    this.debug.log(message);
    if (this.state === this.STATE.CONNECTING) {
      this.emit('connect', ConnectionError(message, 'ESOCKET'));
    } else {
      this.emit('error', ConnectionError(message));
    }
    return this.dispatchEvent('socketError', error);
  };

  Connection.prototype.socketConnect = function() {
    this.socket.setKeepAlive(true, KEEP_ALIVE_INITIAL_DELAY);
    this.closed = false;
    this.debug.log("connected to " + this.config.server + ":" + this.config.options.port);
    return this.dispatchEvent('socketConnect');
  };

  Connection.prototype.socketEnd = function() {
    this.debug.log("socket ended");
    return this.transitionTo(this.STATE.FINAL);
  };

  Connection.prototype.socketClose = function() {
    this.debug.log("connection to " + this.config.server + ":" + this.config.options.port + " closed");
    if (this.state === this.STATE.REROUTING) {
      this.debug.log("Rerouting to " + this.routingData.server + ":" + this.routingData.port);
      return this.dispatchEvent('reconnect');
    } else {
      return this.transitionTo(this.STATE.FINAL);
    }
  };

  Connection.prototype.sendPreLogin = function() {
    var payload;
    payload = new PreloginPayload({
      encrypt: this.config.options.encrypt
    });
    this.messageIo.sendMessage(TYPE.PRELOGIN, payload.data);
    return this.debug.payload(function() {
      return payload.toString('  ');
    });
  };

  Connection.prototype.emptyMessageBuffer = function() {
    return this.messageBuffer = new Buffer(0);
  };

  Connection.prototype.addToMessageBuffer = function(data) {
    return this.messageBuffer = Buffer.concat([this.messageBuffer, data]);
  };

  Connection.prototype.processPreLoginResponse = function() {
    var preloginPayload;
    preloginPayload = new PreloginPayload(this.messageBuffer);
    this.debug.payload(function() {
      return preloginPayload.toString('  ');
    });
    if (preloginPayload.encryptionString === 'ON') {
      return this.dispatchEvent('tls');
    } else {
      return this.dispatchEvent('noTls');
    }
  };

  Connection.prototype.sendLogin7Packet = function() {
    var loginData, payload;
    loginData = {
      domain: this.config.domain,
      userName: this.config.userName,
      password: this.config.password,
      database: this.config.options.database,
      appName: this.config.options.appName,
      packetSize: this.config.options.packetSize,
      tdsVersion: this.config.options.tdsVersion,
      initDbFatal: !this.config.options.fallbackToDefaultDb,
      readOnlyIntent: this.config.options.readOnlyIntent
    };
    payload = new Login7Payload(loginData);
    this.messageIo.sendMessage(TYPE.LOGIN7, payload.data);
    return this.debug.payload(function() {
      return payload.toString('  ');
    });
  };

  Connection.prototype.sendNTLMResponsePacket = function() {
    var payload, responseData;
    responseData = {
      domain: this.config.domain,
      userName: this.config.userName,
      password: this.config.password,
      database: this.config.options.database,
      appName: this.config.options.appName,
      packetSize: this.config.options.packetSize,
      tdsVersion: this.config.options.tdsVersion,
      ntlmpacket: this.ntlmpacket,
      additional: this.additional
    };
    payload = new NTLMResponsePayload(responseData);
    this.messageIo.sendMessage(TYPE.NTLMAUTH_PKT, payload.data);
    return this.debug.payload(function() {
      return payload.toString('  ');
    });
  };

  Connection.prototype.initiateTlsSslHandshake = function() {
    var credentials, _base;
    (_base = this.config.options.cryptoCredentialsDetails).ciphers || (_base.ciphers = 'RC4-MD5');
    credentials = crypto.createCredentials(this.config.options.cryptoCredentialsDetails);
    this.securePair = tls.createSecurePair(credentials);
    this.securePair.on('secure', (function(_this) {
      return function() {
        var cipher;
        cipher = _this.securePair.cleartext.getCipher();
        _this.debug.log("TLS negotiated (" + cipher.name + ", " + cipher.version + ")");
        _this.emit('secure', _this.securePair.cleartext);
        _this.messageIo.encryptAllFutureTraffic();
        return _this.dispatchEvent('tlsNegotiated');
      };
    })(this));
    this.securePair.encrypted.on('data', (function(_this) {
      return function(data) {
        return _this.messageIo.sendMessage(TYPE.PRELOGIN, data);
      };
    })(this));
    return this.messageIo.tlsNegotiationStarting(this.securePair);
  };

  Connection.prototype.sendDataToTokenStreamParser = function(data) {
    return this.tokenStreamParser.addBuffer(data);
  };

  Connection.prototype.sendInitialSql = function() {
    var payload;
    payload = new SqlBatchPayload(this.getInitialSql(), this.currentTransactionDescriptor(), this.config.options);
    return this.messageIo.sendMessage(TYPE.SQL_BATCH, payload.data);
  };

  Connection.prototype.getInitialSql = function() {
    var xact_abort;
    xact_abort = this.config.options.abortTransactionOnError ? 'on' : 'off';
    return "set textsize " + this.config.options.textsize + "\nset quoted_identifier on\nset arithabort off\nset numeric_roundabort off\nset ansi_warnings on\nset ansi_padding on\nset ansi_nulls on\nset concat_null_yields_null on\nset cursor_close_on_commit off\nset implicit_transactions off\nset language us_english\nset dateformat mdy\nset datefirst 7\nset transaction isolation level " + (this.getIsolationLevelText(this.config.options.connectionIsolationLevel)) + "\nset xact_abort " + xact_abort;
  };

  Connection.prototype.processedInitialSql = function() {
    this.clearConnectTimer();
    return this.emit('connect');
  };

  Connection.prototype.processLogin7Response = function() {
    if (this.loggedIn) {
      return this.dispatchEvent('loggedIn');
    } else {
      if (this.loginError) {
        this.emit('connect', this.loginError);
      } else {
        this.emit('connect', ConnectionError('Login failed.', 'ELOGIN'));
      }
      return this.dispatchEvent('loginFailed');
    }
  };

  Connection.prototype.processLogin7NTLMResponse = function() {
    if (this.ntlmpacket) {
      return this.dispatchEvent('receivedChallenge');
    } else {
      if (this.loginError) {
        this.emit('connect', this.loginError);
      } else {
        this.emit('connect', ConnectionError('Login failed.', 'ELOGIN'));
      }
      return this.dispatchEvent('loginFailed');
    }
  };

  Connection.prototype.processLogin7NTLMAck = function() {
    if (this.loggedIn) {
      return this.dispatchEvent('loggedIn');
    } else {
      if (this.loginError) {
        this.emit('connect', this.loginError);
      } else {
        this.emit('connect', ConnectionError('Login failed.', 'ELOGIN'));
      }
      return this.dispatchEvent('loginFailed');
    }
  };

  Connection.prototype.execSqlBatch = function(request) {
    return this.makeRequest(request, TYPE.SQL_BATCH, new SqlBatchPayload(request.sqlTextOrProcedure, this.currentTransactionDescriptor(), this.config.options));
  };

  Connection.prototype.execSql = function(request) {
    request.transformIntoExecuteSqlRpc();
    return this.makeRequest(request, TYPE.RPC_REQUEST, new RpcRequestPayload(request, this.currentTransactionDescriptor(), this.config.options));
  };

  Connection.prototype.newBulkLoad = function(table, callback) {
    return new BulkLoad(table, this.config.options, callback);
  };

  Connection.prototype.execBulkLoad = function(bulkLoad) {
    var request;
    request = new Request(bulkLoad.getBulkInsertSql(), (function(_this) {
      return function(error) {
        if (error) {
          if (error.code === 'UNKNOWN') {
            error.message += ' This is likely because the schema of the BulkLoad does not match the schema of the table you are attempting to insert into.';
          }
          bulkLoad.error = error;
          return bulkLoad.callback(error);
        } else {
          return _this.makeRequest(bulkLoad, TYPE.BULK_LOAD, bulkLoad.getPayload());
        }
      };
    })(this));
    return this.execSqlBatch(request);
  };

  Connection.prototype.prepare = function(request) {
    request.transformIntoPrepareRpc();
    return this.makeRequest(request, TYPE.RPC_REQUEST, new RpcRequestPayload(request, this.currentTransactionDescriptor(), this.config.options));
  };

  Connection.prototype.unprepare = function(request) {
    request.transformIntoUnprepareRpc();
    return this.makeRequest(request, TYPE.RPC_REQUEST, new RpcRequestPayload(request, this.currentTransactionDescriptor(), this.config.options));
  };

  Connection.prototype.execute = function(request, parameters) {
    request.transformIntoExecuteRpc(parameters);
    return this.makeRequest(request, TYPE.RPC_REQUEST, new RpcRequestPayload(request, this.currentTransactionDescriptor(), this.config.options));
  };

  Connection.prototype.callProcedure = function(request) {
    return this.makeRequest(request, TYPE.RPC_REQUEST, new RpcRequestPayload(request, this.currentTransactionDescriptor(), this.config.options));
  };

  Connection.prototype.beginTransaction = function(callback, name, isolationLevel) {
    var request, transaction;
    name || (name = '');
    isolationLevel || (isolationLevel = this.config.options.isolationLevel);
    transaction = new Transaction(name, isolationLevel);
    this.transactions.push(transaction);
    if (this.config.options.tdsVersion < "7_2") {
      return this.execSqlBatch(new Request("SET TRANSACTION ISOLATION LEVEL " + (transaction.isolationLevelToTSQL()) + ";BEGIN TRAN " + transaction.name, callback));
    }
    request = new Request(void 0, (function(_this) {
      return function(err) {
        return callback(err, _this.currentTransactionDescriptor());
      };
    })(this));
    return this.makeRequest(request, TYPE.TRANSACTION_MANAGER, transaction.beginPayload(this.currentTransactionDescriptor()));
  };

  Connection.prototype.commitTransaction = function(callback) {
    var request, transaction;
    if (this.transactions.length === 0) {
      return callback(RequestError('No transaction in progress', 'ENOTRNINPROG'));
    }
    transaction = this.transactions.pop();
    if (this.config.options.tdsVersion < "7_2") {
      return this.execSqlBatch(new Request("COMMIT TRAN " + transaction.name, callback));
    }
    request = new Request(void 0, callback);
    return this.makeRequest(request, TYPE.TRANSACTION_MANAGER, transaction.commitPayload(this.currentTransactionDescriptor()));
  };

  Connection.prototype.rollbackTransaction = function(callback) {
    var request, transaction;
    if (this.transactions.length === 0) {
      return callback(RequestError('No transaction in progress', 'ENOTRNINPROG'));
    }
    transaction = this.transactions.pop();
    if (this.config.options.tdsVersion < "7_2") {
      return this.execSqlBatch(new Request("ROLLBACK TRAN " + transaction.name, callback));
    }
    request = new Request(void 0, callback);
    return this.makeRequest(request, TYPE.TRANSACTION_MANAGER, transaction.rollbackPayload(this.currentTransactionDescriptor()));
  };

  Connection.prototype.makeRequest = function(request, packetType, payload) {
    var message;
    if (this.state !== this.STATE.LOGGED_IN) {
      message = "Requests can only be made in the " + this.STATE.LOGGED_IN.name + " state, not the " + this.state.name + " state";
      this.debug.log(message);
      return request.callback(RequestError(message, 'EINVALIDSTATE'));
    } else {
      this.request = request;
      this.request.rowCount = 0;
      this.request.rows = [];
      this.createRequestTimer();
      this.messageIo.sendMessage(packetType, payload.data, this.resetConnectionOnNextRequest);
      this.resetConnectionOnNextRequest = false;
      this.debug.payload(function() {
        return payload.toString('  ');
      });
      return this.transitionTo(this.STATE.SENT_CLIENT_REQUEST);
    }
  };

  Connection.prototype.cancel = function() {
    var message;
    if (this.state !== this.STATE.SENT_CLIENT_REQUEST) {
      message = "Requests can only be canceled in the " + this.STATE.SENT_CLIENT_REQUEST.name + " state, not the " + this.state.name + " state";
      this.debug.log(message);
      return false;
    } else {
      this.request.canceled = true;
      this.messageIo.sendMessage(TYPE.ATTENTION);
      this.transitionTo(this.STATE.SENT_ATTENTION);
      return true;
    }
  };

  Connection.prototype.reset = function(callback) {
    var request;
    request = new Request(this.getInitialSql(), function(err, rowCount, rows) {
      return callback(err);
    });
    this.resetConnectionOnNextRequest = true;
    return this.execSqlBatch(request);
  };

  Connection.prototype.currentTransactionDescriptor = function() {
    return this.transactionDescriptors[this.transactionDescriptors.length - 1];
  };

  Connection.prototype.getIsolationLevelText = function(isolationLevel) {
    switch (isolationLevel) {
      case ISOLATION_LEVEL.READ_UNCOMMITTED:
        return 'read uncommitted';
      case ISOLATION_LEVEL.REPEATABLE_READ:
        return 'repeatable read';
      case ISOLATION_LEVEL.SERIALIZABLE:
        return 'serializable';
      case ISOLATION_LEVEL.SNAPSHOT:
        return 'snapshot';
      default:
        return 'read committed';
    }
  };

  return Connection;

})(EventEmitter);

module.exports = Connection;