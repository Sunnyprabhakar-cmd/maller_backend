import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import fs$1 from "node:fs/promises";
import require$$0 from "stream";
import { existsSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { createServer } from "node:http";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const defaultSettings = {
  mailgunApiKey: "",
  mailgunDomain: "",
  senderEmails: [],
  recentTestEmails: [],
  defaultReplyTo: "",
  webhookSecret: "",
  throttlePerMinute: 60,
  retryAttempts: 3,
  autoWatchFolder: "",
  imageUploadProvider: "none",
  imageUploadApiKey: "",
  googleDriveEnabled: false,
  googleDriveClientId: "",
  googleDriveClientSecret: "",
  googleDriveRefreshToken: "",
  googleDriveFolderId: "",
  appUsername: "",
  appPassword: ""
};
const defaultCampaignDraft = {
  name: "Spring Launch",
  isNewsletter: false,
  newsletterEdition: "",
  subject: "A fresh update for {{name}}",
  htmlBody: '<h1>Hi {{name}},</h1><p>Your offer code is <strong>{{offer_code}}</strong>.</p><p><a href="{{cta_url}}">Open offer</a></p>',
  textBody: "Hi {{name}}, your offer code is {{offer_code}}.",
  senderEmail: "sales@domain.com",
  replyToEmail: "support@domain.com",
  companyName: "Acme Studio",
  headerCompanyName: "Acme Studio",
  footerCompanyName: "Acme Studio",
  companyAddress: "123 Market Street, San Francisco, CA",
  companyContact: "support@acmestudio.com",
  contactNumber: "+1 (555) 123-4567",
  footerContent: "You are receiving this email because you opted in.",
  logoSourceType: "url",
  logoLinkUrl: "",
  bannerSourceType: "url",
  bannerLinkUrl: "",
  inlineImageSourceType: "url",
  inlineImageLinkUrl: "",
  cidAssets: [],
  ctaUrl: "https://example.com",
  facebookUrl: "",
  instagramUrl: "",
  xUrl: "",
  linkedinUrl: "",
  whatsappUrl: "",
  youtubeUrl: ""
};
function defaultStore() {
  return {
    campaigns: [],
    recipients: [],
    events: [],
    suppressionList: [],
    settings: defaultSettings,
    campaignDraft: defaultCampaignDraft
  };
}
class StorageService {
  filePath;
  data;
  constructor() {
    const dir = app.getPath("userData");
    this.filePath = path.join(dir, "maigun-store.json");
    this.data = this.load();
  }
  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return defaultStore();
      }
      const content = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(content);
      return {
        ...defaultStore(),
        ...parsed,
        settings: { ...defaultSettings, ...parsed.settings },
        campaignDraft: { ...defaultCampaignDraft, ...parsed.campaignDraft }
      };
    } catch {
      return defaultStore();
    }
  }
  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }
  getState() {
    return structuredClone(this.data);
  }
  saveCampaign(campaign) {
    const index = this.data.campaigns.findIndex((entry) => entry.id === campaign.id);
    if (index >= 0) {
      this.data.campaigns[index] = campaign;
    } else {
      this.data.campaigns.unshift(campaign);
    }
    this.persist();
    return campaign;
  }
  deleteCampaign(campaignId) {
    this.data.campaigns = this.data.campaigns.filter((entry) => entry.id !== campaignId);
    this.data.recipients = this.data.recipients.filter((entry) => entry.campaignId !== campaignId);
    this.data.events = this.data.events.filter((entry) => entry.campaignId !== campaignId);
    this.persist();
  }
  saveRecipients(campaignId, recipients) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existingRecipients = this.listRecipients(campaignId);
    const existingByEmail = new Map(existingRecipients.map((recipient) => [recipient.email.toLowerCase(), recipient]));
    const records = recipients.map((recipient) => {
      const normalizedEmail = recipient.email.trim().toLowerCase();
      const existing = existingByEmail.get(normalizedEmail);
      if (existing) {
        return {
          ...existing,
          email: normalizedEmail,
          name: recipient.name,
          customFields: recipient.customFields,
          updatedAt: now
        };
      }
      return {
        ...recipient,
        id: randomUUID(),
        campaignId,
        attempts: 0,
        status: "queued",
        createdAt: now,
        updatedAt: now
      };
    });
    this.data.recipients = this.data.recipients.filter((recipient) => recipient.campaignId !== campaignId).concat(records);
    this.persist();
    return records;
  }
  updateRecipient(recipientId, patch) {
    const recipient = this.data.recipients.find((entry) => entry.id === recipientId);
    if (!recipient) {
      return void 0;
    }
    Object.assign(recipient, patch, { updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    this.persist();
    return recipient;
  }
  listRecipients(campaignId) {
    return this.data.recipients.filter((recipient) => !campaignId || recipient.campaignId === campaignId);
  }
  addEvent(event) {
    this.data.events.unshift(event);
    this.persist();
  }
  listEvents(campaignId) {
    return this.data.events.filter((event) => !campaignId || event.campaignId === campaignId);
  }
  clearEvents(campaignId) {
    if (!campaignId) {
      this.data.events = [];
    } else {
      this.data.events = this.data.events.filter((event) => event.campaignId !== campaignId);
    }
    this.persist();
  }
  isSuppressed(email) {
    const normalized = email.trim().toLowerCase();
    return this.data.suppressionList.includes(normalized);
  }
  addSuppression(email) {
    const normalized = email.trim().toLowerCase();
    if (!this.data.suppressionList.includes(normalized)) {
      this.data.suppressionList.push(normalized);
      this.persist();
    }
  }
  getSettings() {
    return { ...this.data.settings };
  }
  saveSettings(settings) {
    this.data.settings = { ...settings };
    this.persist();
    return this.getSettings();
  }
  getCampaignDraft() {
    return { ...this.data.campaignDraft };
  }
  saveCampaignDraft(draft) {
    this.data.campaignDraft = {
      ...this.data.campaignDraft,
      ...draft
    };
    this.persist();
    return this.getCampaignDraft();
  }
  listCampaigns() {
    return [...this.data.campaigns];
  }
}
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var papaparse = { exports: {} };
/* @license
Papa Parse
v5.5.3
https://github.com/mholt/PapaParse
License: MIT
*/
(function(module, exports$1) {
  (function(root, factory) {
    {
      module.exports = factory();
    }
  })(commonjsGlobal, function moduleFactory() {
    var global2 = function() {
      if (typeof self !== "undefined") {
        return self;
      }
      if (typeof window !== "undefined") {
        return window;
      }
      if (typeof global2 !== "undefined") {
        return global2;
      }
      return {};
    }();
    function getWorkerBlob() {
      var URL2 = global2.URL || global2.webkitURL || null;
      var code = moduleFactory.toString();
      return Papa2.BLOB_URL || (Papa2.BLOB_URL = URL2.createObjectURL(new Blob(["var global = (function() { if (typeof self !== 'undefined') { return self; } if (typeof window !== 'undefined') { return window; } if (typeof global !== 'undefined') { return global; } return {}; })(); global.IS_PAPA_WORKER=true; ", "(", code, ")();"], { type: "text/javascript" })));
    }
    var IS_WORKER = !global2.document && !!global2.postMessage, IS_PAPA_WORKER = global2.IS_PAPA_WORKER || false;
    var workers = {}, workerIdCounter = 0;
    var Papa2 = {};
    Papa2.parse = CsvToJson;
    Papa2.unparse = JsonToCsv;
    Papa2.RECORD_SEP = String.fromCharCode(30);
    Papa2.UNIT_SEP = String.fromCharCode(31);
    Papa2.BYTE_ORDER_MARK = "\uFEFF";
    Papa2.BAD_DELIMITERS = ["\r", "\n", '"', Papa2.BYTE_ORDER_MARK];
    Papa2.WORKERS_SUPPORTED = !IS_WORKER && !!global2.Worker;
    Papa2.NODE_STREAM_INPUT = 1;
    Papa2.LocalChunkSize = 1024 * 1024 * 10;
    Papa2.RemoteChunkSize = 1024 * 1024 * 5;
    Papa2.DefaultDelimiter = ",";
    Papa2.Parser = Parser;
    Papa2.ParserHandle = ParserHandle;
    Papa2.NetworkStreamer = NetworkStreamer;
    Papa2.FileStreamer = FileStreamer;
    Papa2.StringStreamer = StringStreamer;
    Papa2.ReadableStreamStreamer = ReadableStreamStreamer;
    if (typeof PAPA_BROWSER_CONTEXT === "undefined") {
      Papa2.DuplexStreamStreamer = DuplexStreamStreamer;
    }
    if (global2.jQuery) {
      var $ = global2.jQuery;
      $.fn.parse = function(options) {
        var config = options.config || {};
        var queue2 = [];
        this.each(function(idx) {
          var supported = $(this).prop("tagName").toUpperCase() === "INPUT" && $(this).attr("type").toLowerCase() === "file" && global2.FileReader;
          if (!supported || !this.files || this.files.length === 0)
            return true;
          for (var i = 0; i < this.files.length; i++) {
            queue2.push({
              file: this.files[i],
              inputElem: this,
              instanceConfig: $.extend({}, config)
            });
          }
        });
        parseNextFile();
        return this;
        function parseNextFile() {
          if (queue2.length === 0) {
            if (isFunction(options.complete))
              options.complete();
            return;
          }
          var f = queue2[0];
          if (isFunction(options.before)) {
            var returned = options.before(f.file, f.inputElem);
            if (typeof returned === "object") {
              if (returned.action === "abort") {
                error("AbortError", f.file, f.inputElem, returned.reason);
                return;
              } else if (returned.action === "skip") {
                fileComplete();
                return;
              } else if (typeof returned.config === "object")
                f.instanceConfig = $.extend(f.instanceConfig, returned.config);
            } else if (returned === "skip") {
              fileComplete();
              return;
            }
          }
          var userCompleteFunc = f.instanceConfig.complete;
          f.instanceConfig.complete = function(results) {
            if (isFunction(userCompleteFunc))
              userCompleteFunc(results, f.file, f.inputElem);
            fileComplete();
          };
          Papa2.parse(f.file, f.instanceConfig);
        }
        function error(name, file, elem, reason) {
          if (isFunction(options.error))
            options.error({ name }, file, elem, reason);
        }
        function fileComplete() {
          queue2.splice(0, 1);
          parseNextFile();
        }
      };
    }
    if (IS_PAPA_WORKER) {
      global2.onmessage = workerThreadReceivedMessage;
    }
    function CsvToJson(_input, _config) {
      _config = _config || {};
      var dynamicTyping = _config.dynamicTyping || false;
      if (isFunction(dynamicTyping)) {
        _config.dynamicTypingFunction = dynamicTyping;
        dynamicTyping = {};
      }
      _config.dynamicTyping = dynamicTyping;
      _config.transform = isFunction(_config.transform) ? _config.transform : false;
      if (_config.worker && Papa2.WORKERS_SUPPORTED) {
        var w = newWorker();
        w.userStep = _config.step;
        w.userChunk = _config.chunk;
        w.userComplete = _config.complete;
        w.userError = _config.error;
        _config.step = isFunction(_config.step);
        _config.chunk = isFunction(_config.chunk);
        _config.complete = isFunction(_config.complete);
        _config.error = isFunction(_config.error);
        delete _config.worker;
        w.postMessage({
          input: _input,
          config: _config,
          workerId: w.id
        });
        return;
      }
      var streamer = null;
      if (_input === Papa2.NODE_STREAM_INPUT && typeof PAPA_BROWSER_CONTEXT === "undefined") {
        streamer = new DuplexStreamStreamer(_config);
        return streamer.getStream();
      } else if (typeof _input === "string") {
        _input = stripBom(_input);
        if (_config.download)
          streamer = new NetworkStreamer(_config);
        else
          streamer = new StringStreamer(_config);
      } else if (_input.readable === true && isFunction(_input.read) && isFunction(_input.on)) {
        streamer = new ReadableStreamStreamer(_config);
      } else if (global2.File && _input instanceof File || _input instanceof Object)
        streamer = new FileStreamer(_config);
      return streamer.stream(_input);
      function stripBom(string) {
        if (string.charCodeAt(0) === 65279) {
          return string.slice(1);
        }
        return string;
      }
    }
    function JsonToCsv(_input, _config) {
      var _quotes = false;
      var _writeHeader = true;
      var _delimiter = ",";
      var _newline = "\r\n";
      var _quoteChar = '"';
      var _escapedQuote = _quoteChar + _quoteChar;
      var _skipEmptyLines = false;
      var _columns = null;
      var _escapeFormulae = false;
      unpackConfig();
      var quoteCharRegex = new RegExp(escapeRegExp(_quoteChar), "g");
      if (typeof _input === "string")
        _input = JSON.parse(_input);
      if (Array.isArray(_input)) {
        if (!_input.length || Array.isArray(_input[0]))
          return serialize(null, _input, _skipEmptyLines);
        else if (typeof _input[0] === "object")
          return serialize(_columns || Object.keys(_input[0]), _input, _skipEmptyLines);
      } else if (typeof _input === "object") {
        if (typeof _input.data === "string")
          _input.data = JSON.parse(_input.data);
        if (Array.isArray(_input.data)) {
          if (!_input.fields)
            _input.fields = _input.meta && _input.meta.fields || _columns;
          if (!_input.fields)
            _input.fields = Array.isArray(_input.data[0]) ? _input.fields : typeof _input.data[0] === "object" ? Object.keys(_input.data[0]) : [];
          if (!Array.isArray(_input.data[0]) && typeof _input.data[0] !== "object")
            _input.data = [_input.data];
        }
        return serialize(_input.fields || [], _input.data || [], _skipEmptyLines);
      }
      throw new Error("Unable to serialize unrecognized input");
      function unpackConfig() {
        if (typeof _config !== "object")
          return;
        if (typeof _config.delimiter === "string" && !Papa2.BAD_DELIMITERS.filter(function(value) {
          return _config.delimiter.indexOf(value) !== -1;
        }).length) {
          _delimiter = _config.delimiter;
        }
        if (typeof _config.quotes === "boolean" || typeof _config.quotes === "function" || Array.isArray(_config.quotes))
          _quotes = _config.quotes;
        if (typeof _config.skipEmptyLines === "boolean" || typeof _config.skipEmptyLines === "string")
          _skipEmptyLines = _config.skipEmptyLines;
        if (typeof _config.newline === "string")
          _newline = _config.newline;
        if (typeof _config.quoteChar === "string")
          _quoteChar = _config.quoteChar;
        if (typeof _config.header === "boolean")
          _writeHeader = _config.header;
        if (Array.isArray(_config.columns)) {
          if (_config.columns.length === 0) throw new Error("Option columns is empty");
          _columns = _config.columns;
        }
        if (_config.escapeChar !== void 0) {
          _escapedQuote = _config.escapeChar + _quoteChar;
        }
        if (_config.escapeFormulae instanceof RegExp) {
          _escapeFormulae = _config.escapeFormulae;
        } else if (typeof _config.escapeFormulae === "boolean" && _config.escapeFormulae) {
          _escapeFormulae = /^[=+\-@\t\r].*$/;
        }
      }
      function serialize(fields, data, skipEmptyLines) {
        var csv = "";
        if (typeof fields === "string")
          fields = JSON.parse(fields);
        if (typeof data === "string")
          data = JSON.parse(data);
        var hasHeader = Array.isArray(fields) && fields.length > 0;
        var dataKeyedByField = !Array.isArray(data[0]);
        if (hasHeader && _writeHeader) {
          for (var i = 0; i < fields.length; i++) {
            if (i > 0)
              csv += _delimiter;
            csv += safe(fields[i], i);
          }
          if (data.length > 0)
            csv += _newline;
        }
        for (var row = 0; row < data.length; row++) {
          var maxCol = hasHeader ? fields.length : data[row].length;
          var emptyLine = false;
          var nullLine = hasHeader ? Object.keys(data[row]).length === 0 : data[row].length === 0;
          if (skipEmptyLines && !hasHeader) {
            emptyLine = skipEmptyLines === "greedy" ? data[row].join("").trim() === "" : data[row].length === 1 && data[row][0].length === 0;
          }
          if (skipEmptyLines === "greedy" && hasHeader) {
            var line = [];
            for (var c = 0; c < maxCol; c++) {
              var cx = dataKeyedByField ? fields[c] : c;
              line.push(data[row][cx]);
            }
            emptyLine = line.join("").trim() === "";
          }
          if (!emptyLine) {
            for (var col = 0; col < maxCol; col++) {
              if (col > 0 && !nullLine)
                csv += _delimiter;
              var colIdx = hasHeader && dataKeyedByField ? fields[col] : col;
              csv += safe(data[row][colIdx], col);
            }
            if (row < data.length - 1 && (!skipEmptyLines || maxCol > 0 && !nullLine)) {
              csv += _newline;
            }
          }
        }
        return csv;
      }
      function safe(str, col) {
        if (typeof str === "undefined" || str === null)
          return "";
        if (str.constructor === Date)
          return JSON.stringify(str).slice(1, 25);
        var needsQuotes = false;
        if (_escapeFormulae && typeof str === "string" && _escapeFormulae.test(str)) {
          str = "'" + str;
          needsQuotes = true;
        }
        var escapedQuoteStr = str.toString().replace(quoteCharRegex, _escapedQuote);
        needsQuotes = needsQuotes || _quotes === true || typeof _quotes === "function" && _quotes(str, col) || Array.isArray(_quotes) && _quotes[col] || hasAny(escapedQuoteStr, Papa2.BAD_DELIMITERS) || escapedQuoteStr.indexOf(_delimiter) > -1 || escapedQuoteStr.charAt(0) === " " || escapedQuoteStr.charAt(escapedQuoteStr.length - 1) === " ";
        return needsQuotes ? _quoteChar + escapedQuoteStr + _quoteChar : escapedQuoteStr;
      }
      function hasAny(str, substrings) {
        for (var i = 0; i < substrings.length; i++)
          if (str.indexOf(substrings[i]) > -1)
            return true;
        return false;
      }
    }
    function ChunkStreamer(config) {
      this._handle = null;
      this._finished = false;
      this._completed = false;
      this._halted = false;
      this._input = null;
      this._baseIndex = 0;
      this._partialLine = "";
      this._rowCount = 0;
      this._start = 0;
      this._nextChunk = null;
      this.isFirstChunk = true;
      this._completeResults = {
        data: [],
        errors: [],
        meta: {}
      };
      replaceConfig.call(this, config);
      this.parseChunk = function(chunk, isFakeChunk) {
        const skipFirstNLines = parseInt(this._config.skipFirstNLines) || 0;
        if (this.isFirstChunk && skipFirstNLines > 0) {
          let _newline = this._config.newline;
          if (!_newline) {
            const quoteChar = this._config.quoteChar || '"';
            _newline = this._handle.guessLineEndings(chunk, quoteChar);
          }
          const splitChunk = chunk.split(_newline);
          chunk = [...splitChunk.slice(skipFirstNLines)].join(_newline);
        }
        if (this.isFirstChunk && isFunction(this._config.beforeFirstChunk)) {
          var modifiedChunk = this._config.beforeFirstChunk(chunk);
          if (modifiedChunk !== void 0)
            chunk = modifiedChunk;
        }
        this.isFirstChunk = false;
        this._halted = false;
        var aggregate = this._partialLine + chunk;
        this._partialLine = "";
        var results = this._handle.parse(aggregate, this._baseIndex, !this._finished);
        if (this._handle.paused() || this._handle.aborted()) {
          this._halted = true;
          return;
        }
        var lastIndex = results.meta.cursor;
        if (!this._finished) {
          this._partialLine = aggregate.substring(lastIndex - this._baseIndex);
          this._baseIndex = lastIndex;
        }
        if (results && results.data)
          this._rowCount += results.data.length;
        var finishedIncludingPreview = this._finished || this._config.preview && this._rowCount >= this._config.preview;
        if (IS_PAPA_WORKER) {
          global2.postMessage({
            results,
            workerId: Papa2.WORKER_ID,
            finished: finishedIncludingPreview
          });
        } else if (isFunction(this._config.chunk) && !isFakeChunk) {
          this._config.chunk(results, this._handle);
          if (this._handle.paused() || this._handle.aborted()) {
            this._halted = true;
            return;
          }
          results = void 0;
          this._completeResults = void 0;
        }
        if (!this._config.step && !this._config.chunk) {
          this._completeResults.data = this._completeResults.data.concat(results.data);
          this._completeResults.errors = this._completeResults.errors.concat(results.errors);
          this._completeResults.meta = results.meta;
        }
        if (!this._completed && finishedIncludingPreview && isFunction(this._config.complete) && (!results || !results.meta.aborted)) {
          this._config.complete(this._completeResults, this._input);
          this._completed = true;
        }
        if (!finishedIncludingPreview && (!results || !results.meta.paused))
          this._nextChunk();
        return results;
      };
      this._sendError = function(error) {
        if (isFunction(this._config.error))
          this._config.error(error);
        else if (IS_PAPA_WORKER && this._config.error) {
          global2.postMessage({
            workerId: Papa2.WORKER_ID,
            error,
            finished: false
          });
        }
      };
      function replaceConfig(config2) {
        var configCopy = copy(config2);
        configCopy.chunkSize = parseInt(configCopy.chunkSize);
        if (!config2.step && !config2.chunk)
          configCopy.chunkSize = null;
        this._handle = new ParserHandle(configCopy);
        this._handle.streamer = this;
        this._config = configCopy;
      }
    }
    function NetworkStreamer(config) {
      config = config || {};
      if (!config.chunkSize)
        config.chunkSize = Papa2.RemoteChunkSize;
      ChunkStreamer.call(this, config);
      var xhr;
      if (IS_WORKER) {
        this._nextChunk = function() {
          this._readChunk();
          this._chunkLoaded();
        };
      } else {
        this._nextChunk = function() {
          this._readChunk();
        };
      }
      this.stream = function(url) {
        this._input = url;
        this._nextChunk();
      };
      this._readChunk = function() {
        if (this._finished) {
          this._chunkLoaded();
          return;
        }
        xhr = new XMLHttpRequest();
        if (this._config.withCredentials) {
          xhr.withCredentials = this._config.withCredentials;
        }
        if (!IS_WORKER) {
          xhr.onload = bindFunction(this._chunkLoaded, this);
          xhr.onerror = bindFunction(this._chunkError, this);
        }
        xhr.open(this._config.downloadRequestBody ? "POST" : "GET", this._input, !IS_WORKER);
        if (this._config.downloadRequestHeaders) {
          var headers = this._config.downloadRequestHeaders;
          for (var headerName in headers) {
            xhr.setRequestHeader(headerName, headers[headerName]);
          }
        }
        if (this._config.chunkSize) {
          var end = this._start + this._config.chunkSize - 1;
          xhr.setRequestHeader("Range", "bytes=" + this._start + "-" + end);
        }
        try {
          xhr.send(this._config.downloadRequestBody);
        } catch (err) {
          this._chunkError(err.message);
        }
        if (IS_WORKER && xhr.status === 0)
          this._chunkError();
      };
      this._chunkLoaded = function() {
        if (xhr.readyState !== 4)
          return;
        if (xhr.status < 200 || xhr.status >= 400) {
          this._chunkError();
          return;
        }
        this._start += this._config.chunkSize ? this._config.chunkSize : xhr.responseText.length;
        this._finished = !this._config.chunkSize || this._start >= getFileSize(xhr);
        this.parseChunk(xhr.responseText);
      };
      this._chunkError = function(errorMessage) {
        var errorText = xhr.statusText || errorMessage;
        this._sendError(new Error(errorText));
      };
      function getFileSize(xhr2) {
        var contentRange = xhr2.getResponseHeader("Content-Range");
        if (contentRange === null) {
          return -1;
        }
        return parseInt(contentRange.substring(contentRange.lastIndexOf("/") + 1));
      }
    }
    NetworkStreamer.prototype = Object.create(ChunkStreamer.prototype);
    NetworkStreamer.prototype.constructor = NetworkStreamer;
    function FileStreamer(config) {
      config = config || {};
      if (!config.chunkSize)
        config.chunkSize = Papa2.LocalChunkSize;
      ChunkStreamer.call(this, config);
      var reader, slice;
      var usingAsyncReader = typeof FileReader !== "undefined";
      this.stream = function(file) {
        this._input = file;
        slice = file.slice || file.webkitSlice || file.mozSlice;
        if (usingAsyncReader) {
          reader = new FileReader();
          reader.onload = bindFunction(this._chunkLoaded, this);
          reader.onerror = bindFunction(this._chunkError, this);
        } else
          reader = new FileReaderSync();
        this._nextChunk();
      };
      this._nextChunk = function() {
        if (!this._finished && (!this._config.preview || this._rowCount < this._config.preview))
          this._readChunk();
      };
      this._readChunk = function() {
        var input = this._input;
        if (this._config.chunkSize) {
          var end = Math.min(this._start + this._config.chunkSize, this._input.size);
          input = slice.call(input, this._start, end);
        }
        var txt = reader.readAsText(input, this._config.encoding);
        if (!usingAsyncReader)
          this._chunkLoaded({ target: { result: txt } });
      };
      this._chunkLoaded = function(event) {
        this._start += this._config.chunkSize;
        this._finished = !this._config.chunkSize || this._start >= this._input.size;
        this.parseChunk(event.target.result);
      };
      this._chunkError = function() {
        this._sendError(reader.error);
      };
    }
    FileStreamer.prototype = Object.create(ChunkStreamer.prototype);
    FileStreamer.prototype.constructor = FileStreamer;
    function StringStreamer(config) {
      config = config || {};
      ChunkStreamer.call(this, config);
      var remaining;
      this.stream = function(s) {
        remaining = s;
        return this._nextChunk();
      };
      this._nextChunk = function() {
        if (this._finished) return;
        var size = this._config.chunkSize;
        var chunk;
        if (size) {
          chunk = remaining.substring(0, size);
          remaining = remaining.substring(size);
        } else {
          chunk = remaining;
          remaining = "";
        }
        this._finished = !remaining;
        return this.parseChunk(chunk);
      };
    }
    StringStreamer.prototype = Object.create(StringStreamer.prototype);
    StringStreamer.prototype.constructor = StringStreamer;
    function ReadableStreamStreamer(config) {
      config = config || {};
      ChunkStreamer.call(this, config);
      var queue2 = [];
      var parseOnData = true;
      var streamHasEnded = false;
      this.pause = function() {
        ChunkStreamer.prototype.pause.apply(this, arguments);
        this._input.pause();
      };
      this.resume = function() {
        ChunkStreamer.prototype.resume.apply(this, arguments);
        this._input.resume();
      };
      this.stream = function(stream) {
        this._input = stream;
        this._input.on("data", this._streamData);
        this._input.on("end", this._streamEnd);
        this._input.on("error", this._streamError);
      };
      this._checkIsFinished = function() {
        if (streamHasEnded && queue2.length === 1) {
          this._finished = true;
        }
      };
      this._nextChunk = function() {
        this._checkIsFinished();
        if (queue2.length) {
          this.parseChunk(queue2.shift());
        } else {
          parseOnData = true;
        }
      };
      this._streamData = bindFunction(function(chunk) {
        try {
          queue2.push(typeof chunk === "string" ? chunk : chunk.toString(this._config.encoding));
          if (parseOnData) {
            parseOnData = false;
            this._checkIsFinished();
            this.parseChunk(queue2.shift());
          }
        } catch (error) {
          this._streamError(error);
        }
      }, this);
      this._streamError = bindFunction(function(error) {
        this._streamCleanUp();
        this._sendError(error);
      }, this);
      this._streamEnd = bindFunction(function() {
        this._streamCleanUp();
        streamHasEnded = true;
        this._streamData("");
      }, this);
      this._streamCleanUp = bindFunction(function() {
        this._input.removeListener("data", this._streamData);
        this._input.removeListener("end", this._streamEnd);
        this._input.removeListener("error", this._streamError);
      }, this);
    }
    ReadableStreamStreamer.prototype = Object.create(ChunkStreamer.prototype);
    ReadableStreamStreamer.prototype.constructor = ReadableStreamStreamer;
    function DuplexStreamStreamer(_config) {
      var Duplex = require$$0.Duplex;
      var config = copy(_config);
      var parseOnWrite = true;
      var writeStreamHasFinished = false;
      var parseCallbackQueue = [];
      var stream = null;
      this._onCsvData = function(results) {
        var data = results.data;
        if (!stream.push(data) && !this._handle.paused()) {
          this._handle.pause();
        }
      };
      this._onCsvComplete = function() {
        stream.push(null);
      };
      config.step = bindFunction(this._onCsvData, this);
      config.complete = bindFunction(this._onCsvComplete, this);
      ChunkStreamer.call(this, config);
      this._nextChunk = function() {
        if (writeStreamHasFinished && parseCallbackQueue.length === 1) {
          this._finished = true;
        }
        if (parseCallbackQueue.length) {
          parseCallbackQueue.shift()();
        } else {
          parseOnWrite = true;
        }
      };
      this._addToParseQueue = function(chunk, callback) {
        parseCallbackQueue.push(bindFunction(function() {
          this.parseChunk(typeof chunk === "string" ? chunk : chunk.toString(config.encoding));
          if (isFunction(callback)) {
            return callback();
          }
        }, this));
        if (parseOnWrite) {
          parseOnWrite = false;
          this._nextChunk();
        }
      };
      this._onRead = function() {
        if (this._handle.paused()) {
          this._handle.resume();
        }
      };
      this._onWrite = function(chunk, encoding, callback) {
        this._addToParseQueue(chunk, callback);
      };
      this._onWriteComplete = function() {
        writeStreamHasFinished = true;
        this._addToParseQueue("");
      };
      this.getStream = function() {
        return stream;
      };
      stream = new Duplex({
        readableObjectMode: true,
        decodeStrings: false,
        read: bindFunction(this._onRead, this),
        write: bindFunction(this._onWrite, this)
      });
      stream.once("finish", bindFunction(this._onWriteComplete, this));
    }
    if (typeof PAPA_BROWSER_CONTEXT === "undefined") {
      DuplexStreamStreamer.prototype = Object.create(ChunkStreamer.prototype);
      DuplexStreamStreamer.prototype.constructor = DuplexStreamStreamer;
    }
    function ParserHandle(_config) {
      var MAX_FLOAT = Math.pow(2, 53);
      var MIN_FLOAT = -MAX_FLOAT;
      var FLOAT = /^\s*-?(\d+\.?|\.\d+|\d+\.\d+)([eE][-+]?\d+)?\s*$/;
      var ISO_DATE = /^((\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z)))$/;
      var self2 = this;
      var _stepCounter = 0;
      var _rowCounter = 0;
      var _input;
      var _parser;
      var _paused = false;
      var _aborted = false;
      var _delimiterError;
      var _fields = [];
      var _results = {
        // The last results returned from the parser
        data: [],
        errors: [],
        meta: {}
      };
      if (isFunction(_config.step)) {
        var userStep = _config.step;
        _config.step = function(results) {
          _results = results;
          if (needsHeaderRow())
            processResults();
          else {
            processResults();
            if (_results.data.length === 0)
              return;
            _stepCounter += results.data.length;
            if (_config.preview && _stepCounter > _config.preview)
              _parser.abort();
            else {
              _results.data = _results.data[0];
              userStep(_results, self2);
            }
          }
        };
      }
      this.parse = function(input, baseIndex, ignoreLastRow) {
        var quoteChar = _config.quoteChar || '"';
        if (!_config.newline)
          _config.newline = this.guessLineEndings(input, quoteChar);
        _delimiterError = false;
        if (!_config.delimiter) {
          var delimGuess = guessDelimiter(input, _config.newline, _config.skipEmptyLines, _config.comments, _config.delimitersToGuess);
          if (delimGuess.successful)
            _config.delimiter = delimGuess.bestDelimiter;
          else {
            _delimiterError = true;
            _config.delimiter = Papa2.DefaultDelimiter;
          }
          _results.meta.delimiter = _config.delimiter;
        } else if (isFunction(_config.delimiter)) {
          _config.delimiter = _config.delimiter(input);
          _results.meta.delimiter = _config.delimiter;
        }
        var parserConfig = copy(_config);
        if (_config.preview && _config.header)
          parserConfig.preview++;
        _input = input;
        _parser = new Parser(parserConfig);
        _results = _parser.parse(_input, baseIndex, ignoreLastRow);
        processResults();
        return _paused ? { meta: { paused: true } } : _results || { meta: { paused: false } };
      };
      this.paused = function() {
        return _paused;
      };
      this.pause = function() {
        _paused = true;
        _parser.abort();
        _input = isFunction(_config.chunk) ? "" : _input.substring(_parser.getCharIndex());
      };
      this.resume = function() {
        if (self2.streamer._halted) {
          _paused = false;
          self2.streamer.parseChunk(_input, true);
        } else {
          setTimeout(self2.resume, 3);
        }
      };
      this.aborted = function() {
        return _aborted;
      };
      this.abort = function() {
        _aborted = true;
        _parser.abort();
        _results.meta.aborted = true;
        if (isFunction(_config.complete))
          _config.complete(_results);
        _input = "";
      };
      this.guessLineEndings = function(input, quoteChar) {
        input = input.substring(0, 1024 * 1024);
        var re = new RegExp(escapeRegExp(quoteChar) + "([^]*?)" + escapeRegExp(quoteChar), "gm");
        input = input.replace(re, "");
        var r = input.split("\r");
        var n = input.split("\n");
        var nAppearsFirst = n.length > 1 && n[0].length < r[0].length;
        if (r.length === 1 || nAppearsFirst)
          return "\n";
        var numWithN = 0;
        for (var i = 0; i < r.length; i++) {
          if (r[i][0] === "\n")
            numWithN++;
        }
        return numWithN >= r.length / 2 ? "\r\n" : "\r";
      };
      function testEmptyLine(s) {
        return _config.skipEmptyLines === "greedy" ? s.join("").trim() === "" : s.length === 1 && s[0].length === 0;
      }
      function testFloat(s) {
        if (FLOAT.test(s)) {
          var floatValue = parseFloat(s);
          if (floatValue > MIN_FLOAT && floatValue < MAX_FLOAT) {
            return true;
          }
        }
        return false;
      }
      function processResults() {
        if (_results && _delimiterError) {
          addError("Delimiter", "UndetectableDelimiter", "Unable to auto-detect delimiting character; defaulted to '" + Papa2.DefaultDelimiter + "'");
          _delimiterError = false;
        }
        if (_config.skipEmptyLines) {
          _results.data = _results.data.filter(function(d) {
            return !testEmptyLine(d);
          });
        }
        if (needsHeaderRow())
          fillHeaderFields();
        return applyHeaderAndDynamicTypingAndTransformation();
      }
      function needsHeaderRow() {
        return _config.header && _fields.length === 0;
      }
      function fillHeaderFields() {
        if (!_results)
          return;
        function addHeader(header, i2) {
          if (isFunction(_config.transformHeader))
            header = _config.transformHeader(header, i2);
          _fields.push(header);
        }
        if (Array.isArray(_results.data[0])) {
          for (var i = 0; needsHeaderRow() && i < _results.data.length; i++)
            _results.data[i].forEach(addHeader);
          _results.data.splice(0, 1);
        } else
          _results.data.forEach(addHeader);
      }
      function shouldApplyDynamicTyping(field) {
        if (_config.dynamicTypingFunction && _config.dynamicTyping[field] === void 0) {
          _config.dynamicTyping[field] = _config.dynamicTypingFunction(field);
        }
        return (_config.dynamicTyping[field] || _config.dynamicTyping) === true;
      }
      function parseDynamic(field, value) {
        if (shouldApplyDynamicTyping(field)) {
          if (value === "true" || value === "TRUE")
            return true;
          else if (value === "false" || value === "FALSE")
            return false;
          else if (testFloat(value))
            return parseFloat(value);
          else if (ISO_DATE.test(value))
            return new Date(value);
          else
            return value === "" ? null : value;
        }
        return value;
      }
      function applyHeaderAndDynamicTypingAndTransformation() {
        if (!_results || !_config.header && !_config.dynamicTyping && !_config.transform)
          return _results;
        function processRow(rowSource, i) {
          var row = _config.header ? {} : [];
          var j;
          for (j = 0; j < rowSource.length; j++) {
            var field = j;
            var value = rowSource[j];
            if (_config.header)
              field = j >= _fields.length ? "__parsed_extra" : _fields[j];
            if (_config.transform)
              value = _config.transform(value, field);
            value = parseDynamic(field, value);
            if (field === "__parsed_extra") {
              row[field] = row[field] || [];
              row[field].push(value);
            } else
              row[field] = value;
          }
          if (_config.header) {
            if (j > _fields.length)
              addError("FieldMismatch", "TooManyFields", "Too many fields: expected " + _fields.length + " fields but parsed " + j, _rowCounter + i);
            else if (j < _fields.length)
              addError("FieldMismatch", "TooFewFields", "Too few fields: expected " + _fields.length + " fields but parsed " + j, _rowCounter + i);
          }
          return row;
        }
        var incrementBy = 1;
        if (!_results.data.length || Array.isArray(_results.data[0])) {
          _results.data = _results.data.map(processRow);
          incrementBy = _results.data.length;
        } else
          _results.data = processRow(_results.data, 0);
        if (_config.header && _results.meta)
          _results.meta.fields = _fields;
        _rowCounter += incrementBy;
        return _results;
      }
      function guessDelimiter(input, newline, skipEmptyLines, comments, delimitersToGuess) {
        var bestDelim, bestDelta, fieldCountPrevRow, maxFieldCount;
        delimitersToGuess = delimitersToGuess || [",", "	", "|", ";", Papa2.RECORD_SEP, Papa2.UNIT_SEP];
        for (var i = 0; i < delimitersToGuess.length; i++) {
          var delim = delimitersToGuess[i];
          var delta = 0, avgFieldCount = 0, emptyLinesCount = 0;
          fieldCountPrevRow = void 0;
          var preview = new Parser({
            comments,
            delimiter: delim,
            newline,
            preview: 10
          }).parse(input);
          for (var j = 0; j < preview.data.length; j++) {
            if (skipEmptyLines && testEmptyLine(preview.data[j])) {
              emptyLinesCount++;
              continue;
            }
            var fieldCount = preview.data[j].length;
            avgFieldCount += fieldCount;
            if (typeof fieldCountPrevRow === "undefined") {
              fieldCountPrevRow = fieldCount;
              continue;
            } else if (fieldCount > 0) {
              delta += Math.abs(fieldCount - fieldCountPrevRow);
              fieldCountPrevRow = fieldCount;
            }
          }
          if (preview.data.length > 0)
            avgFieldCount /= preview.data.length - emptyLinesCount;
          if ((typeof bestDelta === "undefined" || delta <= bestDelta) && (typeof maxFieldCount === "undefined" || avgFieldCount > maxFieldCount) && avgFieldCount > 1.99) {
            bestDelta = delta;
            bestDelim = delim;
            maxFieldCount = avgFieldCount;
          }
        }
        _config.delimiter = bestDelim;
        return {
          successful: !!bestDelim,
          bestDelimiter: bestDelim
        };
      }
      function addError(type, code, msg, row) {
        var error = {
          type,
          code,
          message: msg
        };
        if (row !== void 0) {
          error.row = row;
        }
        _results.errors.push(error);
      }
    }
    function escapeRegExp(string) {
      return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function Parser(config) {
      config = config || {};
      var delim = config.delimiter;
      var newline = config.newline;
      var comments = config.comments;
      var step = config.step;
      var preview = config.preview;
      var fastMode = config.fastMode;
      var quoteChar;
      var renamedHeaders = null;
      var headerParsed = false;
      if (config.quoteChar === void 0 || config.quoteChar === null) {
        quoteChar = '"';
      } else {
        quoteChar = config.quoteChar;
      }
      var escapeChar = quoteChar;
      if (config.escapeChar !== void 0) {
        escapeChar = config.escapeChar;
      }
      if (typeof delim !== "string" || Papa2.BAD_DELIMITERS.indexOf(delim) > -1)
        delim = ",";
      if (comments === delim)
        throw new Error("Comment character same as delimiter");
      else if (comments === true)
        comments = "#";
      else if (typeof comments !== "string" || Papa2.BAD_DELIMITERS.indexOf(comments) > -1)
        comments = false;
      if (newline !== "\n" && newline !== "\r" && newline !== "\r\n")
        newline = "\n";
      var cursor = 0;
      var aborted = false;
      this.parse = function(input, baseIndex, ignoreLastRow) {
        if (typeof input !== "string")
          throw new Error("Input must be a string");
        var inputLen = input.length, delimLen = delim.length, newlineLen = newline.length, commentsLen = comments.length;
        var stepIsFunction = isFunction(step);
        cursor = 0;
        var data = [], errors = [], row = [], lastCursor = 0;
        if (!input)
          return returnable();
        if (fastMode || fastMode !== false && input.indexOf(quoteChar) === -1) {
          var rows = input.split(newline);
          for (var i = 0; i < rows.length; i++) {
            row = rows[i];
            cursor += row.length;
            if (i !== rows.length - 1)
              cursor += newline.length;
            else if (ignoreLastRow)
              return returnable();
            if (comments && row.substring(0, commentsLen) === comments)
              continue;
            if (stepIsFunction) {
              data = [];
              pushRow(row.split(delim));
              doStep();
              if (aborted)
                return returnable();
            } else
              pushRow(row.split(delim));
            if (preview && i >= preview) {
              data = data.slice(0, preview);
              return returnable(true);
            }
          }
          return returnable();
        }
        var nextDelim = input.indexOf(delim, cursor);
        var nextNewline = input.indexOf(newline, cursor);
        var quoteCharRegex = new RegExp(escapeRegExp(escapeChar) + escapeRegExp(quoteChar), "g");
        var quoteSearch = input.indexOf(quoteChar, cursor);
        for (; ; ) {
          if (input[cursor] === quoteChar) {
            quoteSearch = cursor;
            cursor++;
            for (; ; ) {
              quoteSearch = input.indexOf(quoteChar, quoteSearch + 1);
              if (quoteSearch === -1) {
                if (!ignoreLastRow) {
                  errors.push({
                    type: "Quotes",
                    code: "MissingQuotes",
                    message: "Quoted field unterminated",
                    row: data.length,
                    // row has yet to be inserted
                    index: cursor
                  });
                }
                return finish();
              }
              if (quoteSearch === inputLen - 1) {
                var value = input.substring(cursor, quoteSearch).replace(quoteCharRegex, quoteChar);
                return finish(value);
              }
              if (quoteChar === escapeChar && input[quoteSearch + 1] === escapeChar) {
                quoteSearch++;
                continue;
              }
              if (quoteChar !== escapeChar && quoteSearch !== 0 && input[quoteSearch - 1] === escapeChar) {
                continue;
              }
              if (nextDelim !== -1 && nextDelim < quoteSearch + 1) {
                nextDelim = input.indexOf(delim, quoteSearch + 1);
              }
              if (nextNewline !== -1 && nextNewline < quoteSearch + 1) {
                nextNewline = input.indexOf(newline, quoteSearch + 1);
              }
              var checkUpTo = nextNewline === -1 ? nextDelim : Math.min(nextDelim, nextNewline);
              var spacesBetweenQuoteAndDelimiter = extraSpaces(checkUpTo);
              if (input.substr(quoteSearch + 1 + spacesBetweenQuoteAndDelimiter, delimLen) === delim) {
                row.push(input.substring(cursor, quoteSearch).replace(quoteCharRegex, quoteChar));
                cursor = quoteSearch + 1 + spacesBetweenQuoteAndDelimiter + delimLen;
                if (input[quoteSearch + 1 + spacesBetweenQuoteAndDelimiter + delimLen] !== quoteChar) {
                  quoteSearch = input.indexOf(quoteChar, cursor);
                }
                nextDelim = input.indexOf(delim, cursor);
                nextNewline = input.indexOf(newline, cursor);
                break;
              }
              var spacesBetweenQuoteAndNewLine = extraSpaces(nextNewline);
              if (input.substring(quoteSearch + 1 + spacesBetweenQuoteAndNewLine, quoteSearch + 1 + spacesBetweenQuoteAndNewLine + newlineLen) === newline) {
                row.push(input.substring(cursor, quoteSearch).replace(quoteCharRegex, quoteChar));
                saveRow(quoteSearch + 1 + spacesBetweenQuoteAndNewLine + newlineLen);
                nextDelim = input.indexOf(delim, cursor);
                quoteSearch = input.indexOf(quoteChar, cursor);
                if (stepIsFunction) {
                  doStep();
                  if (aborted)
                    return returnable();
                }
                if (preview && data.length >= preview)
                  return returnable(true);
                break;
              }
              errors.push({
                type: "Quotes",
                code: "InvalidQuotes",
                message: "Trailing quote on quoted field is malformed",
                row: data.length,
                // row has yet to be inserted
                index: cursor
              });
              quoteSearch++;
              continue;
            }
            continue;
          }
          if (comments && row.length === 0 && input.substring(cursor, cursor + commentsLen) === comments) {
            if (nextNewline === -1)
              return returnable();
            cursor = nextNewline + newlineLen;
            nextNewline = input.indexOf(newline, cursor);
            nextDelim = input.indexOf(delim, cursor);
            continue;
          }
          if (nextDelim !== -1 && (nextDelim < nextNewline || nextNewline === -1)) {
            row.push(input.substring(cursor, nextDelim));
            cursor = nextDelim + delimLen;
            nextDelim = input.indexOf(delim, cursor);
            continue;
          }
          if (nextNewline !== -1) {
            row.push(input.substring(cursor, nextNewline));
            saveRow(nextNewline + newlineLen);
            if (stepIsFunction) {
              doStep();
              if (aborted)
                return returnable();
            }
            if (preview && data.length >= preview)
              return returnable(true);
            continue;
          }
          break;
        }
        return finish();
        function pushRow(row2) {
          data.push(row2);
          lastCursor = cursor;
        }
        function extraSpaces(index) {
          var spaceLength = 0;
          if (index !== -1) {
            var textBetweenClosingQuoteAndIndex = input.substring(quoteSearch + 1, index);
            if (textBetweenClosingQuoteAndIndex && textBetweenClosingQuoteAndIndex.trim() === "") {
              spaceLength = textBetweenClosingQuoteAndIndex.length;
            }
          }
          return spaceLength;
        }
        function finish(value2) {
          if (ignoreLastRow)
            return returnable();
          if (typeof value2 === "undefined")
            value2 = input.substring(cursor);
          row.push(value2);
          cursor = inputLen;
          pushRow(row);
          if (stepIsFunction)
            doStep();
          return returnable();
        }
        function saveRow(newCursor) {
          cursor = newCursor;
          pushRow(row);
          row = [];
          nextNewline = input.indexOf(newline, cursor);
        }
        function returnable(stopped) {
          if (config.header && !baseIndex && data.length && !headerParsed) {
            const result = data[0];
            const headerCount = /* @__PURE__ */ Object.create(null);
            const usedHeaders = new Set(result);
            let duplicateHeaders = false;
            for (let i2 = 0; i2 < result.length; i2++) {
              let header = result[i2];
              if (isFunction(config.transformHeader))
                header = config.transformHeader(header, i2);
              if (!headerCount[header]) {
                headerCount[header] = 1;
                result[i2] = header;
              } else {
                let newHeader;
                let suffixCount = headerCount[header];
                do {
                  newHeader = `${header}_${suffixCount}`;
                  suffixCount++;
                } while (usedHeaders.has(newHeader));
                usedHeaders.add(newHeader);
                result[i2] = newHeader;
                headerCount[header]++;
                duplicateHeaders = true;
                if (renamedHeaders === null) {
                  renamedHeaders = {};
                }
                renamedHeaders[newHeader] = header;
              }
              usedHeaders.add(header);
            }
            if (duplicateHeaders) {
              console.warn("Duplicate headers found and renamed.");
            }
            headerParsed = true;
          }
          return {
            data,
            errors,
            meta: {
              delimiter: delim,
              linebreak: newline,
              aborted,
              truncated: !!stopped,
              cursor: lastCursor + (baseIndex || 0),
              renamedHeaders
            }
          };
        }
        function doStep() {
          step(returnable());
          data = [];
          errors = [];
        }
      };
      this.abort = function() {
        aborted = true;
      };
      this.getCharIndex = function() {
        return cursor;
      };
    }
    function newWorker() {
      if (!Papa2.WORKERS_SUPPORTED)
        return false;
      var workerUrl = getWorkerBlob();
      var w = new global2.Worker(workerUrl);
      w.onmessage = mainThreadReceivedMessage;
      w.id = workerIdCounter++;
      workers[w.id] = w;
      return w;
    }
    function mainThreadReceivedMessage(e) {
      var msg = e.data;
      var worker = workers[msg.workerId];
      var aborted = false;
      if (msg.error)
        worker.userError(msg.error, msg.file);
      else if (msg.results && msg.results.data) {
        var abort = function() {
          aborted = true;
          completeWorker(msg.workerId, { data: [], errors: [], meta: { aborted: true } });
        };
        var handle = {
          abort,
          pause: notImplemented,
          resume: notImplemented
        };
        if (isFunction(worker.userStep)) {
          for (var i = 0; i < msg.results.data.length; i++) {
            worker.userStep({
              data: msg.results.data[i],
              errors: msg.results.errors,
              meta: msg.results.meta
            }, handle);
            if (aborted)
              break;
          }
          delete msg.results;
        } else if (isFunction(worker.userChunk)) {
          worker.userChunk(msg.results, handle, msg.file);
          delete msg.results;
        }
      }
      if (msg.finished && !aborted)
        completeWorker(msg.workerId, msg.results);
    }
    function completeWorker(workerId, results) {
      var worker = workers[workerId];
      if (isFunction(worker.userComplete))
        worker.userComplete(results);
      worker.terminate();
      delete workers[workerId];
    }
    function notImplemented() {
      throw new Error("Not implemented.");
    }
    function workerThreadReceivedMessage(e) {
      var msg = e.data;
      if (typeof Papa2.WORKER_ID === "undefined" && msg)
        Papa2.WORKER_ID = msg.workerId;
      if (typeof msg.input === "string") {
        global2.postMessage({
          workerId: Papa2.WORKER_ID,
          results: Papa2.parse(msg.input, msg.config),
          finished: true
        });
      } else if (global2.File && msg.input instanceof File || msg.input instanceof Object) {
        var results = Papa2.parse(msg.input, msg.config);
        if (results)
          global2.postMessage({
            workerId: Papa2.WORKER_ID,
            results,
            finished: true
          });
      }
    }
    function copy(obj) {
      if (typeof obj !== "object" || obj === null)
        return obj;
      var cpy = Array.isArray(obj) ? [] : {};
      for (var key in obj)
        cpy[key] = copy(obj[key]);
      return cpy;
    }
    function bindFunction(f, self2) {
      return function() {
        f.apply(self2, arguments);
      };
    }
    function isFunction(func) {
      return typeof func === "function";
    }
    return Papa2;
  });
})(papaparse);
var papaparseExports = papaparse.exports;
const Papa = /* @__PURE__ */ getDefaultExportFromCjs(papaparseExports);
const BLOCKED_DOMAINS = /* @__PURE__ */ new Set([
  "mailinator.com",
  "10minutemail.com",
  "tempmail.com",
  "guerrillamail.com",
  "yopmail.com"
]);
function isValidDomain(domain) {
  if (!domain || domain.length < 4) return false;
  if (!domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  if (/\.\./.test(domain)) return false;
  return /^[a-z0-9.-]+$/i.test(domain);
}
function isValidEmail(email) {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email);
}
function parseRecipientsCsv(csvText) {
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const rows = parsed.data ?? [];
  const seen = /* @__PURE__ */ new Set();
  const validRows = [];
  const invalidRows = [];
  let duplicateCount = 0;
  rows.forEach((row, index) => {
    const email = String(row.email ?? "").trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      invalidRows.push({ row: index + 2, reason: "Invalid or missing email" });
      return;
    }
    const domain = email.split("@")[1] ?? "";
    if (!isValidDomain(domain)) {
      invalidRows.push({ row: index + 2, reason: "Invalid email domain" });
      return;
    }
    if (BLOCKED_DOMAINS.has(domain)) {
      invalidRows.push({ row: index + 2, reason: "Disposable email domain is blocked" });
      return;
    }
    if (seen.has(email)) {
      duplicateCount += 1;
      invalidRows.push({ row: index + 2, reason: "Duplicate email" });
      return;
    }
    seen.add(email);
    const { email: _email, name, ...rest } = row;
    const customFields = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== void 0 && String(value).trim() !== "")
    );
    validRows.push({
      email,
      name: name?.trim() || void 0,
      customFields
    });
  });
  return {
    validCount: validRows.length,
    invalidCount: invalidRows.length,
    duplicateCount,
    totalCount: rows.length,
    rows: validRows,
    invalidRows
  };
}
const __dirname$1 = fileURLToPath(new URL(".", import.meta.url));
const SOCIAL_ICON_CID = {
  facebook: "social_facebook",
  instagram: "social_instagram",
  x: "social_x",
  linkedin: "social_linkedin",
  whatsapp: "social_whatsapp",
  youtube: "social_youtube"
};
function resolveSocialIconPath(fileName) {
  const candidates = [
    resolve(process.cwd(), "src/shared/social-icons", fileName),
    resolve(process.cwd(), "dist/shared/social-icons", fileName),
    resolve(__dirname$1, "../../shared/social-icons", fileName)
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
const SOCIAL_ICON_PATHS = {
  facebook: resolveSocialIconPath("facebook.png"),
  instagram: resolveSocialIconPath("instagram.png"),
  x: resolveSocialIconPath("x.png"),
  linkedin: resolveSocialIconPath("linkedin.png"),
  whatsapp: resolveSocialIconPath("whatsapp.png"),
  youtube: resolveSocialIconPath("youtube.png")
};
function resolveImageSrc(url, sourceType, cid) {
  if (sourceType === "cid" && cid?.trim()) {
    return `cid:${cid.trim()}`;
  }
  return url?.trim() ?? "";
}
function normalizeLinkUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return "";
    }
    if (!parsed.hostname) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}
function buildSocialIconLink(href, label, cidRef, iconSize) {
  if (!href || !href.trim()) {
    return "";
  }
  return `<a href="${href}" aria-label="${label}" title="${label}" style="display:inline-block;margin:0 2px;vertical-align:middle;"><img src="cid:${cidRef}" alt="${label}" style="width:${iconSize}px;height:${iconSize}px;border-radius:50%;display:block;border:none;" /></a>`;
}
function compactFragment(html) {
  return html.replace(/<!--([\s\S]*?)-->/g, "").replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim();
}
function minifyEmailHtml(html) {
  return html.replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").replace(/\n+/g, "").trim();
}
function bodyContainsCidImage(bodyHtml, cid) {
  const cleanCid = (cid ?? "").trim();
  if (!cleanCid) {
    return false;
  }
  const escapedCid = cleanCid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<img\\b[^>]*src=["']cid:${escapedCid}["'][^>]*>`, "i").test(bodyHtml);
}
function renderTemplate(content, recipient, campaign) {
  const variables = {
    name: recipient.name ?? "",
    email: recipient.email,
    campaign_name: campaign.name,
    company_name: campaign.companyName,
    header_company_name: campaign.headerCompanyName || campaign.companyName,
    footer_company_name: campaign.footerCompanyName || campaign.companyName,
    cta_url: campaign.ctaUrl ?? "",
    company_address: campaign.companyAddress,
    company_contact: campaign.companyContact,
    contact_number: campaign.contactNumber,
    whatsapp_url: campaign.whatsappUrl ?? "",
    youtube_url: campaign.youtubeUrl ?? "",
    offer_code: recipient.customFields?.offer_code ?? "",
    unsubscribe_url: recipient.customFields?.unsubscribe_url ?? "#",
    ...Object.fromEntries(Object.entries(recipient.customFields ?? {}))
  };
  return content.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => variables[key] ?? "");
}
function renderCampaignSubject(campaign, recipient) {
  return compactFragment(renderTemplate(campaign.subject, recipient, campaign));
}
function buildEmailHtml(campaign, recipient) {
  const body = compactFragment(renderTemplate(campaign.htmlBody, recipient, campaign));
  const bodyHasLogoCid = bodyContainsCidImage(body, campaign.logoSourceType === "cid" ? campaign.logoCid : void 0);
  const bodyHasBannerCid = bodyContainsCidImage(body, campaign.bannerSourceType === "cid" ? campaign.bannerCid : void 0);
  const bodyHasFeaturedCid = bodyContainsCidImage(body, campaign.inlineImageSourceType === "cid" ? campaign.inlineImageCid : void 0);
  const logoSrc = resolveImageSrc(campaign.logoUrl, campaign.logoSourceType, campaign.logoCid);
  const logoLink = normalizeLinkUrl(campaign.logoLinkUrl);
  const logo = logoSrc && !bodyHasLogoCid ? `<tr><td align="center" style="padding:0 0 18px 0;">${logoLink ? `<a href="${logoLink}" style="text-decoration:none;"><img src="${logoSrc}" alt="${campaign.headerCompanyName || campaign.companyName} logo" width="84" style="display:block;width:84px;max-width:84px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;" /></a>` : `<img src="${logoSrc}" alt="${campaign.headerCompanyName || campaign.companyName} logo" width="84" style="display:block;width:84px;max-width:84px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;" />`}</td></tr>` : "";
  const bannerSrc = resolveImageSrc(campaign.bannerUrl, campaign.bannerSourceType, campaign.bannerCid);
  const bannerLink = normalizeLinkUrl(campaign.bannerLinkUrl ?? campaign.ctaUrl);
  const banner = bannerSrc && !bodyHasBannerCid ? `<tr><td align="center" style="padding:0 0 18px 0;">${bannerLink ? `<a href="${bannerLink}" style="text-decoration:none;"><img src="${bannerSrc}" alt="Banner" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;border-radius:12px;" /></a>` : `<img src="${bannerSrc}" alt="Banner" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;border-radius:12px;" />`}</td></tr>` : "";
  const inlineImageSrc = resolveImageSrc(campaign.inlineImageUrl, campaign.inlineImageSourceType, campaign.inlineImageCid);
  const inlineImageLink = normalizeLinkUrl(campaign.inlineImageLinkUrl);
  const socialIconSize = [28, 32, 36].includes(Number(campaign.socialIconSize)) ? Number(campaign.socialIconSize) : 32;
  const inlineImage = inlineImageSrc && !bodyHasFeaturedCid ? `<tr><td align="center" style="padding:0 0 18px 0;">${inlineImageLink ? `<a href="${inlineImageLink}" style="text-decoration:none;"><img src="${inlineImageSrc}" alt="Inline image" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;border-radius:10px;" /></a>` : `<img src="${inlineImageSrc}" alt="Inline image" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;border-radius:10px;" />`}</td></tr>` : "";
  const unsubscribeUrl = renderTemplate("{{unsubscribe_url}}", recipient, campaign);
  const socialLabelRow = [
    buildSocialIconLink(campaign.facebookUrl, "Facebook", SOCIAL_ICON_CID.facebook, socialIconSize),
    buildSocialIconLink(campaign.instagramUrl, "Instagram", SOCIAL_ICON_CID.instagram, socialIconSize),
    buildSocialIconLink(campaign.xUrl, "X", SOCIAL_ICON_CID.x, socialIconSize),
    buildSocialIconLink(campaign.linkedinUrl, "LinkedIn", SOCIAL_ICON_CID.linkedin, socialIconSize),
    buildSocialIconLink(campaign.whatsappUrl, "WhatsApp", SOCIAL_ICON_CID.whatsapp, socialIconSize),
    buildSocialIconLink(campaign.youtubeUrl, "YouTube", SOCIAL_ICON_CID.youtube, socialIconSize)
  ].filter(Boolean).join("");
  const newsletterBadge = campaign.isNewsletter ? `<span style="display:inline-block;background:#f2ece2;border:1px solid #dcc8a6;padding:6px 10px;border-radius:999px;font-size:11px;line-height:1;color:#574935;">Newsletter ${campaign.newsletterEdition || "Edition"}</span>` : "";
  const contactNumber = campaign.contactNumber ? `<tr><td align="center" style="padding:4px 0 0 0;font-size:12px;line-height:18px;color:#666;"><a href="tel:${campaign.contactNumber}" style="color:#666;text-decoration:none;">${campaign.contactNumber}</a></td></tr>` : "";
  return minifyEmailHtml(`
    <html lang="en" style="color-scheme:light; supported-color-schemes:light;">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>${campaign.subject}</title>
      </head>
      <body style="margin:0;padding:0;background-color:#f7f5ef;color:#1b1b1b;font-family:Arial,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f7f5ef;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
          <tr>
            <td align="center" style="padding:24px 16px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:720px;background-color:#ffffff;border:1px solid #eadfcb;border-radius:16px;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;overflow:hidden;">
                ${newsletterBadge ? `<tr><td align="center" style="padding:24px 24px 0 24px;">${newsletterBadge}</td></tr>` : ""}
                ${logo ? `<tr><td align="center" style="padding:18px 24px 0 24px;">${logo.replace(/^<tr><td[^>]*>|<\/td><\/tr>$/g, "")}</td></tr>` : ""}
                ${banner ? `<tr><td align="center" style="padding:18px 24px 0 24px;">${banner.replace(/^<tr><td[^>]*>|<\/td><\/tr>$/g, "")}</td></tr>` : ""}
                ${inlineImage ? `<tr><td align="center" style="padding:18px 24px 0 24px;">${inlineImage.replace(/^<tr><td[^>]*>|<\/td><\/tr>$/g, "")}</td></tr>` : ""}
                <tr>
                  <td align="center" style="padding:0 24px 18px 24px;line-height:1.6;font-size:15px;color:#1b1b1b;">${body}</td>
                </tr>
                <tr>
                  <td align="center" style="padding:18px 24px 0 24px;font-size:12px;line-height:1.5;color:#666;">${campaign.footerContent}</td>
                </tr>
                <tr>
                  <td align="center" style="padding:8px 24px 0 24px;font-size:12px;line-height:1.5;color:#555;">${campaign.footerCompanyName || campaign.companyName}</td>
                </tr>
                <tr>
                  <td align="center" style="padding:4px 24px 0 24px;font-size:12px;line-height:1.5;color:#666;">${campaign.companyAddress}</td>
                </tr>
                <tr>
                  <td align="center" style="padding:4px 24px 0 24px;font-size:12px;line-height:1.5;color:#666;">${campaign.companyContact}</td>
                </tr>
                ${contactNumber}
                <tr>
                  <td align="center" style="padding:14px 24px 0 24px;">${socialLabelRow}</td>
                </tr>
                <tr>
                  <td align="center" style="padding:14px 24px 24px 24px;">
                    <a href="${unsubscribeUrl}" style="display:inline-block;padding:8px 14px;border-radius:999px;background:#f5efea;border:1px solid #d9c9b7;color:#5f4936;font-size:12px;line-height:1;text-decoration:none;">Unsubscribe</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `);
}
function buildTextFallback(campaign, recipient) {
  const fallback = campaign.textBody || campaign.htmlBody.replace(/<[^>]+>/g, " ");
  return renderTemplate(fallback, recipient, campaign).replace(/\s{2,}/g, " ").trim();
}
function getSocialIconCidAssets() {
  return Object.entries(SOCIAL_ICON_PATHS).map(([key, filePath]) => ({
    cid: SOCIAL_ICON_CID[key],
    filePath,
    fileName: `${key}.png`
  }));
}
function inferMimeType(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}
function collectInlineAssets(campaign) {
  const candidates = [
    { type: campaign.logoSourceType, cid: campaign.logoCid, path: campaign.logoPath, label: "Logo" },
    { type: campaign.bannerSourceType, cid: campaign.bannerCid, path: campaign.bannerPath, label: "Banner" },
    { type: campaign.inlineImageSourceType, cid: campaign.inlineImageCid, path: campaign.inlineImagePath, label: "Inline image" }
  ];
  const assets = [];
  for (const candidate of candidates) {
    if (candidate.type !== "cid") {
      continue;
    }
    const cid = candidate.cid?.trim();
    const filePath = candidate.path?.trim();
    if (!cid && !filePath) {
      continue;
    }
    if (!cid || !filePath) {
      return { assets: [], error: `${candidate.label} is set to CID mode but CID or local file is missing.` };
    }
    assets.push({ cid, filePath, fileName: path.basename(filePath), mimeType: inferMimeType(filePath) });
  }
  for (const asset of campaign.cidAssets ?? []) {
    const cid = asset.cid?.trim();
    const filePath = asset.filePath?.trim();
    if (!cid && !filePath) {
      continue;
    }
    if (!cid || !filePath) {
      return { assets: [], error: "One of the additional CID assets is missing CID or local file." };
    }
    assets.push({ cid, filePath, fileName: path.basename(filePath), mimeType: inferMimeType(filePath) });
  }
  const uniqueByCid = /* @__PURE__ */ new Map();
  for (const asset of assets) {
    uniqueByCid.set(asset.cid, asset);
  }
  return { assets: [...uniqueByCid.values()] };
}
async function sendWithMailgun(campaign, recipient, settings) {
  if (!settings.mailgunApiKey || !settings.mailgunDomain) {
    return { ok: false, status: "failed", error: "Mailgun is not configured" };
  }
  const socialIconAssets = getSocialIconCidAssets();
  const campaignWithSocial = {
    ...campaign,
    cidAssets: [...campaign.cidAssets ?? [], ...socialIconAssets]
  };
  const inlineAssets = collectInlineAssets(campaignWithSocial);
  if (inlineAssets.error) {
    return { ok: false, status: "failed", error: inlineAssets.error };
  }
  const form = new FormData();
  form.append("from", campaign.senderEmail);
  form.append("to", recipient.email);
  form.append("subject", renderCampaignSubject(campaign, recipient));
  form.append("html", buildEmailHtml(campaign, recipient));
  form.append("text", buildTextFallback(campaign, recipient));
  form.append("h:Reply-To", campaign.replyToEmail || settings.defaultReplyTo);
  form.append("v:campaignId", campaign.id);
  form.append("o:tracking", "yes");
  form.append("o:tracking-opens", "yes");
  form.append("o:tracking-clicks", "yes");
  for (const asset of inlineAssets.assets) {
    try {
      const data = await fs$1.readFile(asset.filePath);
      const blob = new Blob([data], { type: asset.mimeType });
      form.append("inline", blob, asset.cid);
    } catch {
      return { ok: false, status: "failed", error: `Unable to read CID file: ${asset.filePath}` };
    }
  }
  try {
    const response = await fetch(`https://api.mailgun.net/v3/${settings.mailgunDomain}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${settings.mailgunApiKey}`).toString("base64")}`
      },
      body: form
    });
    if (response.ok) {
      return { ok: true, status: "sent", httpStatus: response.status };
    }
    const bodyText = await response.text();
    const retryAfterRaw = response.headers.get("retry-after");
    const retryAfterSec = Number(retryAfterRaw ?? "");
    const retryAfterMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? Math.floor(retryAfterSec * 1e3) : void 0;
    if (response.status === 400) {
      return { ok: false, status: "failed", httpStatus: 400, category: "bad_request", retryable: false, error: bodyText || "Bad request to Mailgun" };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: "failed", httpStatus: response.status, category: "auth", retryable: false, error: bodyText || "Mailgun authentication failed" };
    }
    if (response.status === 429) {
      return {
        ok: false,
        status: "failed",
        httpStatus: 429,
        category: "rate_limited",
        retryable: true,
        retryAfterMs,
        error: bodyText || "Mailgun rate limit reached"
      };
    }
    if (response.status >= 500) {
      return { ok: false, status: "failed", httpStatus: response.status, category: "server", retryable: true, error: bodyText || "Mailgun server error" };
    }
    return { ok: false, status: "failed", httpStatus: response.status, category: "unknown", retryable: false, error: bodyText || "Mailgun request failed" };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      category: "network",
      retryable: true,
      error: error.message || "Network error while sending email"
    };
  }
}
class QueueService {
  constructor(storage2) {
    this.storage = storage2;
  }
  running = false;
  timer;
  tokenBucket = {
    tokens: 1,
    capacity: 1,
    refillPerMs: 1 / 6e4,
    updatedAt: Date.now()
  };
  start() {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.processNext(), 1e3);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = void 0;
    }
  }
  async enqueueCampaign(campaign) {
    this.storage.clearEvents(campaign.id);
    const recipients = this.storage.listRecipients(campaign.id);
    for (const recipient of recipients) {
      if (this.storage.isSuppressed(recipient.email)) {
        this.storage.updateRecipient(recipient.id, { status: "suppressed", attempts: 0, lastError: void 0 });
        this.storage.addEvent(this.eventFor(campaign.id, recipient.email, "unsubscribed", { reason: "suppressed" }));
      } else {
        this.storage.updateRecipient(recipient.id, { status: "queued", attempts: 0, lastError: void 0 });
      }
    }
    this.storage.saveCampaign({ ...campaign, status: "queued" });
    await this.processNext();
  }
  async resumeCampaign(campaign) {
    this.storage.saveCampaign({ ...campaign, status: "queued" });
    await this.processNext();
  }
  pauseCampaign(campaign) {
    this.storage.saveCampaign({ ...campaign, status: "paused" });
  }
  getCampaignProgress(campaignId) {
    const recipients = this.storage.listRecipients(campaignId);
    const total = recipients.length;
    const queued = recipients.filter((entry) => entry.status === "queued").length;
    const sent = recipients.filter((entry) => entry.status === "sent").length;
    const failed = recipients.filter((entry) => entry.status === "failed").length;
    const suppressed = recipients.filter((entry) => entry.status === "suppressed").length;
    const inProgress = Math.max(0, total - queued - sent - failed - suppressed);
    const percent = total === 0 ? 0 : Math.round((sent + failed + suppressed) / total * 100);
    return { total, queued, sent, failed, suppressed, inProgress, percent };
  }
  sleep(ms) {
    return new Promise((resolve2) => setTimeout(resolve2, ms));
  }
  configureTokenBucket(throttlePerMinute) {
    const ratePerMinute = Math.max(1, Number.isFinite(throttlePerMinute) ? Math.floor(throttlePerMinute) : 60);
    const capacity = Math.max(1, Math.min(20, Math.ceil(ratePerMinute / 6)));
    this.tokenBucket.capacity = capacity;
    this.tokenBucket.refillPerMs = ratePerMinute / 6e4;
    this.tokenBucket.tokens = Math.min(this.tokenBucket.tokens, capacity);
    this.tokenBucket.updatedAt = Date.now();
  }
  refillTokens(now) {
    const elapsed = Math.max(0, now - this.tokenBucket.updatedAt);
    if (elapsed <= 0) return;
    const refill = elapsed * this.tokenBucket.refillPerMs;
    this.tokenBucket.tokens = Math.min(this.tokenBucket.capacity, this.tokenBucket.tokens + refill);
    this.tokenBucket.updatedAt = now;
  }
  async waitForSendSlot(throttlePerMinute) {
    this.configureTokenBucket(throttlePerMinute);
    while (true) {
      const now = Date.now();
      this.refillTokens(now);
      if (this.tokenBucket.tokens >= 1) {
        this.tokenBucket.tokens -= 1;
        return;
      }
      const need = 1 - this.tokenBucket.tokens;
      const waitMs = Math.max(100, Math.ceil(need / this.tokenBucket.refillPerMs));
      await this.sleep(waitMs);
    }
  }
  retryDelayMs(attempt, hintedRetryAfterMs) {
    if (hintedRetryAfterMs && hintedRetryAfterMs > 0) {
      return Math.min(12e4, hintedRetryAfterMs);
    }
    if (attempt <= 1) return 1e3;
    if (attempt === 2) return 5e3;
    return 3e4;
  }
  async processNext() {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const campaigns = this.storage.listCampaigns().filter((campaign2) => {
        if (campaign2.status === "queued" || campaign2.status === "sending") {
          return true;
        }
        if (campaign2.status === "scheduled" && campaign2.scheduledAt) {
          return new Date(campaign2.scheduledAt).getTime() <= Date.now();
        }
        return false;
      });
      const campaign = campaigns[0];
      if (!campaign) {
        return;
      }
      this.storage.saveCampaign({ ...campaign, status: "sending" });
      const settings = this.storage.getSettings();
      const batch = this.storage.listRecipients(campaign.id).filter((recipient) => recipient.status === "queued");
      let sentCount = 0;
      let failedCount = 0;
      for (const recipient of batch) {
        const refreshedCampaign = this.storage.listCampaigns().find((entry) => entry.id === campaign.id);
        if (!refreshedCampaign || refreshedCampaign.status === "paused") {
          return;
        }
        const current = this.storage.listRecipients(campaign.id).find((entry) => entry.id === recipient.id);
        if (!current || current.status !== "queued") {
          continue;
        }
        if (this.storage.isSuppressed(recipient.email)) {
          this.storage.updateRecipient(recipient.id, { status: "suppressed" });
          continue;
        }
        let attempts = 0;
        let lastError = "";
        while (attempts < Math.max(1, settings.retryAttempts)) {
          attempts += 1;
          await this.waitForSendSlot(settings.throttlePerMinute);
          const result = await sendWithMailgun(refreshedCampaign, recipient, settings);
          if (result.ok) {
            this.storage.updateRecipient(recipient.id, { status: "sent", attempts });
            this.storage.addEvent(this.eventFor(campaign.id, recipient.email, "sent", { attempts }));
            sentCount += 1;
            break;
          }
          lastError = result.error ?? "Unknown error";
          const shouldRetry = result.retryable !== false && attempts < settings.retryAttempts;
          if (shouldRetry) {
            const waitMs = this.retryDelayMs(attempts, result.retryAfterMs);
            await this.sleep(waitMs);
            continue;
          }
          this.storage.updateRecipient(recipient.id, { status: "failed", attempts, lastError });
          this.storage.addEvent(this.eventFor(campaign.id, recipient.email, "failed", {
            attempts,
            error: lastError,
            category: result.category,
            httpStatus: result.httpStatus,
            retryable: result.retryable
          }));
          failedCount += 1;
          break;
        }
      }
      this.storage.saveCampaign({ ...campaign, status: sentCount > 0 || failedCount === 0 ? "sent" : "failed" });
    } finally {
      this.running = false;
    }
  }
  eventFor(campaignId, recipientEmail, type, payload) {
    return {
      id: randomUUID(),
      campaignId,
      recipientEmail,
      type,
      payload,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
}
function normalizeEventType(input) {
  const event = String(input ?? "").toLowerCase();
  if (event === "opened" || event === "clicked" || event === "delivered" || event === "complained" || event === "unsubscribed" || event === "failed" || event === "sent") {
    return event;
  }
  if (event === "permanent_fail" || event === "temporary_fail" || event === "bounced") {
    return "bounced";
  }
  return event || "failed";
}
function sanitizeLogText(value) {
  return String(value ?? "").replace(/[\r\n\t]/g, " ").slice(0, 500);
}
function parseJsonObject(input) {
  try {
    const parsed = JSON.parse(input, (_key, value) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.assign(/* @__PURE__ */ Object.create(null), value);
      }
      return value;
    });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return void 0;
    }
    return parsed;
  } catch {
    return void 0;
  }
}
function toSafePayload(campaignId, email, event) {
  return {
    campaignId: campaignId ?? "",
    email,
    event
  };
}
function parseCampaignId(value) {
  const str = String(value ?? "").trim();
  return str || void 0;
}
function resolveCampaignId(storage2, explicitCampaignId, recipientEmail) {
  if (explicitCampaignId?.trim()) {
    return explicitCampaignId.trim();
  }
  const allCampaigns = storage2.listCampaigns();
  for (const campaign of allCampaigns) {
    const matched = storage2.listRecipients(campaign.id).find((entry) => entry.email.toLowerCase() === recipientEmail.toLowerCase());
    if (matched) {
      return campaign.id;
    }
  }
  return void 0;
}
function parsePayload(body, contentType) {
  const ct = String(contentType ?? "").toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(body);
    const eventDataRaw = params.get("event-data");
    const topLevelTimestamp = params.get("timestamp") ?? void 0;
    const topLevelToken = params.get("token") ?? void 0;
    const topLevelSignature = params.get("signature") ?? void 0;
    if (eventDataRaw) {
      if (eventDataRaw.length > 256 * 1024) {
        return void 0;
      }
      const eventDataObj = parseJsonObject(eventDataRaw);
      if (!eventDataObj) {
        return void 0;
      }
      const eventData2 = eventDataObj;
      const vars = eventData2["user-variables"] ?? eventData2.user_variables ?? {};
      const campaignId3 = parseCampaignId(vars.campaignId);
      const email3 = String(eventData2.recipient ?? "");
      const event3 = String(eventData2.event ?? "");
      const signature2 = eventData2.signature;
      const resolvedSignature = signature2?.timestamp && signature2?.token && signature2?.signature ? {
        timestamp: String(signature2.timestamp),
        token: String(signature2.token),
        signature: String(signature2.signature)
      } : topLevelTimestamp && topLevelToken && topLevelSignature ? {
        timestamp: String(topLevelTimestamp),
        token: String(topLevelToken),
        signature: String(topLevelSignature)
      } : void 0;
      return {
        campaignId: campaignId3,
        email: email3,
        event: event3,
        signature: resolvedSignature,
        payload: toSafePayload(campaignId3, email3, event3)
      };
    }
    const campaignId2 = parseCampaignId(params.get("campaignId"));
    const email2 = String(params.get("recipient") ?? params.get("email") ?? "");
    const event2 = String(params.get("event") ?? "");
    const signature = topLevelTimestamp && topLevelToken && topLevelSignature ? {
      timestamp: String(topLevelTimestamp),
      token: String(topLevelToken),
      signature: String(topLevelSignature)
    } : void 0;
    return {
      campaignId: campaignId2,
      email: email2,
      event: event2,
      signature,
      payload: toSafePayload(campaignId2, email2, event2)
    };
  }
  const parsed = parseJsonObject(body);
  if (!parsed) {
    return void 0;
  }
  const eventData = parsed["event-data"] ?? parsed.event_data;
  if (eventData) {
    const vars = eventData["user-variables"] ?? eventData.user_variables ?? {};
    const campaignId2 = parseCampaignId(vars.campaignId);
    const email2 = String(eventData.recipient ?? "");
    const event2 = String(eventData.event ?? "");
    const signature = eventData.signature;
    return {
      campaignId: campaignId2,
      email: email2,
      event: event2,
      signature: signature?.timestamp && signature?.token && signature?.signature ? {
        timestamp: String(signature.timestamp),
        token: String(signature.token),
        signature: String(signature.signature)
      } : void 0,
      payload: toSafePayload(campaignId2, email2, event2)
    };
  }
  const campaignId = parseCampaignId(parsed.campaignId);
  const email = String(parsed.email ?? parsed.recipient ?? "");
  const event = String(parsed.event ?? "");
  return {
    campaignId,
    email,
    event,
    payload: toSafePayload(campaignId, email, event)
  };
}
function verifyWebhookSignature(storage2, signature) {
  const secret = storage2.getSettings().webhookSecret.trim();
  if (!secret) {
    return true;
  }
  if (!signature?.timestamp || !signature?.token || !signature?.signature) {
    return false;
  }
  const digestHex = createHmac("sha256", secret).update(`${signature.timestamp}${signature.token}`).digest("hex");
  const received = Buffer.from(signature.signature, "hex");
  const expected = Buffer.from(digestHex, "hex");
  if (received.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(received, expected);
}
function createServerForPort(storage2, options) {
  return createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    const normalizedPath = requestUrl.pathname.replace(/\/+$/, "") || "/";
    if (req.method !== "POST" || normalizedPath !== "/webhooks/mailgun") {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const maxBodyBytes = 1024 * 1024;
    let body = "";
    let ended = false;
    req.on("data", (chunk) => {
      if (ended) {
        return;
      }
      body += chunk.toString("utf8");
      if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
        ended = true;
        res.statusCode = 413;
        res.end("Payload too large");
        req.destroy();
      }
    });
    req.on("end", () => {
      if (ended) {
        return;
      }
      try {
        const parsed = parsePayload(body, req.headers["content-type"]);
        if (!parsed) {
          res.statusCode = 400;
          res.end("invalid payload");
          return;
        }
        if (!verifyWebhookSignature(storage2, parsed.signature)) {
          res.statusCode = 401;
          res.end("invalid webhook signature");
          return;
        }
        const email = String(parsed.email ?? "").trim().toLowerCase();
        const eventType = normalizeEventType(parsed.event);
        if (!email || !eventType) {
          res.statusCode = 202;
          res.end("ignored");
          return;
        }
        const campaignId = resolveCampaignId(storage2, parsed.campaignId, email);
        if (!campaignId) {
          res.statusCode = 202;
          res.end("campaign not found");
          return;
        }
        const createdAt = (/* @__PURE__ */ new Date()).toISOString();
        storage2.addEvent({
          id: randomUUID(),
          campaignId,
          recipientEmail: email,
          type: eventType,
          payload: {
            ...parsed.payload ?? {},
            _source: "mailgun-webhook"
          },
          createdAt
        });
        options?.onEvent?.({ campaignId, email, eventType, createdAt });
        if (eventType === "bounced" || eventType === "complained" || eventType === "unsubscribed") {
          storage2.addSuppression(email);
        }
        res.statusCode = 200;
        res.end("ok");
      } catch (error) {
        res.statusCode = 400;
        res.end("invalid payload");
        console.error("Webhook payload processing failed:", sanitizeLogText(error.message));
      }
    });
  });
}
async function listenOnAvailablePort(storage2, options, preferredPort = 3535) {
  for (let port = preferredPort; port <= preferredPort + 10; port += 1) {
    const server = createServerForPort(storage2, options);
    const listenPort = await new Promise((resolve2) => {
      const onError = (error) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE") {
          resolve2(void 0);
          return;
        }
        throw error;
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        resolve2(address?.port ?? port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
    if (listenPort) {
      return { server, port: listenPort };
    }
    await new Promise((resolve2) => setTimeout(resolve2, 50));
  }
  throw new Error("Unable to start webhook server: all ports are in use");
}
async function startWebhookServer(storage2, options) {
  const { server, port } = await listenOnAvailablePort(storage2, options);
  console.log(`Mailgun webhook server listening on 127.0.0.1:${port}`);
  return {
    close: () => server.close(),
    port
  };
}
const storage = new StorageService();
const queue = new QueueService(storage);
let webhookServer;
let webhookPort = 3535;
function resolvePreloadPath() {
  const candidates = [
    path.join(__dirname, "../preload/index.js"),
    path.join(__dirname, "../preload/index.mjs")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}
function createWindow() {
  const window2 = new BrowserWindow({
    width: 1440,
    height: 980,
    backgroundColor: "#f7f5ef",
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    window2.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    window2.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return window2;
}
app.whenReady().then(async () => {
  queue.start();
  webhookServer = await startWebhookServer(storage, {
    onEvent: (payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("webhook:received", payload);
      }
    }
  });
  webhookPort = webhookServer.port;
  createWindow();
});
app.on("window-all-closed", () => {
  queue.stop();
  webhookServer?.close();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
ipcMain.handle("app:get-state", () => storage.getState());
ipcMain.handle("webhook:port", () => webhookPort);
ipcMain.handle("campaign:create", (_event, input) => {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const campaign = {
    id: randomUUID(),
    name: input.name ?? "Untitled Campaign",
    isNewsletter: input.isNewsletter ?? false,
    newsletterEdition: input.newsletterEdition ?? "",
    subject: input.subject ?? "",
    htmlBody: input.htmlBody ?? "<p>Hello {{name}}</p>",
    textBody: input.textBody ?? "Hello {{name}}",
    senderEmail: input.senderEmail ?? "",
    replyToEmail: input.replyToEmail ?? "",
    companyName: input.companyName ?? "Company",
    companyAddress: input.companyAddress ?? "",
    companyContact: input.companyContact ?? "",
    contactNumber: input.contactNumber ?? "",
    footerContent: input.footerContent ?? "You received this email because you subscribed.",
    logoUrl: input.logoUrl,
    logoLinkUrl: input.logoLinkUrl,
    logoSourceType: input.logoSourceType ?? "url",
    logoCid: input.logoCid,
    logoPath: input.logoPath,
    bannerUrl: input.bannerUrl,
    bannerLinkUrl: input.bannerLinkUrl,
    bannerSourceType: input.bannerSourceType ?? "url",
    bannerCid: input.bannerCid,
    bannerPath: input.bannerPath,
    inlineImageUrl: input.inlineImageUrl,
    inlineImageLinkUrl: input.inlineImageLinkUrl,
    inlineImageSourceType: input.inlineImageSourceType ?? "url",
    inlineImageCid: input.inlineImageCid,
    inlineImagePath: input.inlineImagePath,
    cidAssets: input.cidAssets ?? [],
    ctaUrl: input.ctaUrl,
    ctaImageUrl: input.ctaImageUrl,
    facebookUrl: input.facebookUrl,
    instagramUrl: input.instagramUrl,
    xUrl: input.xUrl,
    linkedinUrl: input.linkedinUrl,
    whatsappUrl: input.whatsappUrl,
    youtubeUrl: input.youtubeUrl,
    socialIconSize: input.socialIconSize === 28 || input.socialIconSize === 36 ? input.socialIconSize : 32,
    scheduledAt: input.scheduledAt,
    status: "draft",
    createdAt: now,
    updatedAt: now
  };
  storage.saveCampaign(campaign);
  return campaign;
});
ipcMain.handle("campaign:save", (_event, campaign) => {
  return storage.saveCampaign({ ...campaign, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
});
ipcMain.handle("campaign:list", () => storage.listCampaigns());
ipcMain.handle("campaign:delete", (_event, campaignId) => {
  storage.deleteCampaign(campaignId);
  return { ok: true };
});
ipcMain.handle("campaign:duplicate", (_event, campaignId) => {
  const source = storage.listCampaigns().find((entry) => entry.id === campaignId);
  if (!source) {
    throw new Error("Campaign not found");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const duplicate = {
    ...source,
    id: randomUUID(),
    name: `${source.name} (Copy)`,
    status: "draft",
    createdAt: now,
    updatedAt: now
  };
  storage.saveCampaign(duplicate);
  return duplicate;
});
ipcMain.handle("csv:parse", (_event, csvText) => parseRecipientsCsv(csvText));
ipcMain.handle("csv:import", (_event, campaignId, csvText) => {
  const summary = parseRecipientsCsv(csvText);
  storage.saveRecipients(campaignId, summary.rows);
  return summary;
});
ipcMain.handle("recipients:list", (_event, campaignId) => storage.listRecipients(campaignId));
ipcMain.handle("queue:send", (_event, campaignId, override) => {
  const stored = storage.listCampaigns().find((entry) => entry.id === campaignId);
  if (!stored) {
    throw new Error("Campaign not found");
  }
  const campaign = {
    ...stored,
    ...override ?? {},
    id: stored.id,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  storage.saveCampaign(campaign);
  const recipients = storage.listRecipients(campaign.id);
  if (recipients.length === 0) {
    return { queued: false, noRecipients: true };
  }
  const deliverableRecipients = recipients.filter((entry) => !storage.isSuppressed(entry.email));
  if (deliverableRecipients.length === 0) {
    return { queued: false, noDeliverableRecipients: true };
  }
  if (campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now()) {
    storage.saveCampaign({ ...campaign, status: "scheduled" });
    return { queued: false, scheduled: true };
  }
  void queue.enqueueCampaign(campaign);
  return { queued: true };
});
ipcMain.handle("queue:pause", (_event, campaignId) => {
  const campaign = storage.listCampaigns().find((entry) => entry.id === campaignId);
  if (!campaign) {
    throw new Error("Campaign not found");
  }
  queue.pauseCampaign(campaign);
  return { paused: true };
});
ipcMain.handle("queue:resume", (_event, campaignId) => {
  const campaign = storage.listCampaigns().find((entry) => entry.id === campaignId);
  if (!campaign) {
    throw new Error("Campaign not found");
  }
  void queue.resumeCampaign(campaign);
  return { resumed: true };
});
ipcMain.handle("queue:progress", (_event, campaignId) => {
  return queue.getCampaignProgress(campaignId);
});
ipcMain.handle("queue:send-test", async (_event, campaignId, testEmail, override) => {
  const stored = storage.listCampaigns().find((entry) => entry.id === campaignId);
  if (!stored) {
    throw new Error("Campaign not found");
  }
  const campaign = {
    ...stored,
    ...override ?? {},
    id: stored.id,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  storage.saveCampaign(campaign);
  const settings = storage.getSettings();
  const result = await sendWithMailgun(
    campaign,
    {
      email: testEmail,
      name: "Test User",
      customFields: {
        unsubscribe_url: "https://example.com/unsubscribe"
      }
    },
    settings
  );
  return result;
});
ipcMain.handle("settings:get", () => storage.getSettings());
ipcMain.handle("settings:save", (_event, settings) => storage.saveSettings(settings));
ipcMain.handle("draft:get", () => storage.getCampaignDraft());
ipcMain.handle("draft:save", (_event, draft) => {
  return storage.saveCampaignDraft(draft);
});
ipcMain.handle("events:list", (_event, campaignId) => storage.listEvents(campaignId));
ipcMain.handle("report:export-campaigns", async () => {
  const campaigns = storage.listCampaigns();
  const lines = [
    ["Campaign Name", "Status", "Total Recipients", "Sent", "Failed", "Suppressed", "Delivered", "Opened", "Clicked", "Bounced", "Open Rate %", "Click Rate %", "Bounce Rate %", "Last Updated"].join(",")
  ];
  for (const campaign of campaigns) {
    const recipients = storage.listRecipients(campaign.id);
    const sent = recipients.filter((entry) => entry.status === "sent").length;
    const failed = recipients.filter((entry) => entry.status === "failed").length;
    const suppressed = recipients.filter((entry) => entry.status === "suppressed").length;
    const campaignEvents = storage.listEvents(campaign.id);
    const webhookEvents = campaignEvents.filter((event) => event?.payload?._source === "mailgun-webhook");
    const realWebhookEvents = webhookEvents.filter((event) => event?.payload?._simulated !== true);
    const delivered = new Set(realWebhookEvents.filter((event) => event.type === "delivered").map((event) => String(event.recipientEmail ?? "").toLowerCase())).size;
    const opened = new Set(realWebhookEvents.filter((event) => event.type === "opened").map((event) => String(event.recipientEmail ?? "").toLowerCase())).size;
    const clicked = new Set(realWebhookEvents.filter((event) => event.type === "clicked").map((event) => String(event.recipientEmail ?? "").toLowerCase())).size;
    const bounced = new Set(realWebhookEvents.filter((event) => event.type === "bounced").map((event) => String(event.recipientEmail ?? "").toLowerCase())).size;
    const base = Math.max(delivered, sent);
    const openRate = base ? Math.min(100, Math.floor(opened / base * 100)) : 0;
    const clickRate = base ? Math.min(100, Math.floor(clicked / base * 100)) : 0;
    const bounceRate = base ? Math.min(100, Math.floor(bounced / base * 100)) : 0;
    const row = [
      campaign.name,
      campaign.status,
      String(recipients.length),
      String(sent),
      String(failed),
      String(suppressed),
      String(delivered),
      String(opened),
      String(clicked),
      String(bounced),
      String(openRate),
      String(clickRate),
      String(bounceRate),
      campaign.updatedAt
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",");
    lines.push(row);
  }
  const now = /* @__PURE__ */ new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const save = await dialog.showSaveDialog({
    title: "Save campaign report",
    defaultPath: `maigun-campaign-report-${stamp}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });
  if (save.canceled || !save.filePath) {
    return { ok: false, canceled: true };
  }
  fs.writeFileSync(save.filePath, `${lines.join("\n")}
`, "utf8");
  return { ok: true, filePath: save.filePath };
});
ipcMain.handle("webhook:simulate", (_event, campaignId, eventType = "opened") => {
  const recipients = storage.listRecipients(campaignId);
  const recipientEmail = recipients[0]?.email ?? "simulated@example.com";
  const normalized = String(eventType).toLowerCase();
  const supported = /* @__PURE__ */ new Set(["delivered", "opened", "clicked", "bounced", "complained", "unsubscribed"]);
  const type = supported.has(normalized) ? normalized : "opened";
  const addSimulatedEvent = (eventName) => {
    storage.addEvent({
      id: randomUUID(),
      campaignId,
      recipientEmail,
      type: eventName,
      payload: {
        _source: "mailgun-webhook",
        _simulated: true
      },
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  };
  if (type === "opened" || type === "clicked") {
    addSimulatedEvent("delivered");
  }
  addSimulatedEvent(type);
  if (type === "bounced" || type === "complained" || type === "unsubscribed") {
    storage.addSuppression(recipientEmail);
  }
  return { ok: true, campaignId, recipientEmail, eventType: type };
});
ipcMain.handle("suppression:add", (_event, email) => {
  storage.addSuppression(email);
  return { ok: true };
});
ipcMain.handle("csv:pick", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose CSV file",
    properties: ["openFile"],
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  return { canceled: false, filePath: result.filePaths[0] };
});
ipcMain.handle("image:pick-local", async () => {
  const pick = await dialog.showOpenDialog({
    title: "Choose image for CID",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }]
  });
  if (pick.canceled || pick.filePaths.length === 0) {
    return { canceled: true };
  }
  const filePath = pick.filePaths[0];
  const fileName = path.basename(filePath);
  const baseName = fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  const defaultCid = `${baseName || "image"}-${randomUUID().slice(0, 8)}`;
  return {
    canceled: false,
    filePath,
    fileName,
    cid: defaultCid
  };
});
ipcMain.handle("image:social-icons", async () => {
  const socialIcons = {};
  const iconNames = ["facebook", "instagram", "x", "linkedin", "whatsapp", "youtube"];
  for (const name of iconNames) {
    try {
      const candidates = [
        path.join(process.cwd(), "src/shared/social-icons", `${name}.png`),
        path.join(app.getAppPath(), "src/shared/social-icons", `${name}.png`),
        path.join(app.getAppPath(), "dist/shared/social-icons", `${name}.png`)
      ];
      const filePath = candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
      const data = await fs$1.readFile(filePath);
      socialIcons[name] = `data:image/png;base64,${data.toString("base64")}`;
    } catch (error) {
      console.error(`Failed to read social icon ${name}:`, error);
    }
  }
  return socialIcons;
});
