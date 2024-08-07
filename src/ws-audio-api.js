//    WebSockets Audio API
//
//    Opus Quality Settings
//    =====================
//    App: 2048=voip, 2049=audio, 2051=low-delay
//    Sample Rate: 8000, 12000, 16000, 24000, or 48000
//    Frame Duration: 2.5, 5, 10, 20, 40, 60
//    Buffer Size = sample rate/6000 * 1024


(function(global) {
	var defaultConfig = {
		codec: {
			sampleRate: 48000,
			channels: 1,
			app: 2048,
			frameDuration: 60,
			bufferSize: 4096
		},
		server: {
			host: 'wss://' + window.location.hostname + ':5000'
		},
	};
	var isStreaming = false;

	// Функция для создания и инициализации Player и Streamer
	this.initPlayerAndStreamer = function() {
		if (isStreaming === false){
			socket = new WebSocket(defaultConfig.server.host);

			socket.onopen = function() {
				console.log('Socket is open');

				// Создание экземпляра Player
				var player = new WSAudioAPI.Player(defaultConfig, socket);
				player.start();

				// Создание экземпляра Streamer
				var streamer = new WSAudioAPI.Streamer(defaultConfig, socket);
				streamer.start(function(error) {
					console.error('Error getting user media:', error);
				});
				isStreaming = true;
			};
		}
		else {
			socket.close();
			isStreaming = false;
		}
    }
	this.createAudioContext = function() {
		if (!window.audioContext) {
			window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
		}
		return window.audioContext;
	}

	var WSAudioAPI = global.WSAudioAPI = {
		Player: function(config, socket) {
			this.config = config || {};
			this.config.codec = this.config.codec || defaultConfig.codec;
			this.config.server = this.config.server || defaultConfig.server;
			this.sampler = new Resampler(this.config.codec.sampleRate, createAudioContext().sampleRate, 1, this.config.codec.bufferSize);
			this.parentSocket = socket;

			this.decoder = new OpusDecoder(this.config.codec.sampleRate, this.config.codec.channels);
			this.silence = new Float32Array(this.config.codec.bufferSize);
		},
		Streamer: function(config, socket) {
			navigator.getUserMedia = (navigator.getUserMedia ||
				navigator.webkitGetUserMedia ||
				navigator.mozGetUserMedia ||
				navigator.msGetUserMedia);

			this.config = config || {};
			this.config.codec = this.config.codec || defaultConfig.codec;
			this.config.server = this.config.server || defaultConfig.server;
			this.sampler = new Resampler(audioContext.sampleRate, createAudioContext().sampleRate, 1, this.config.codec.bufferSize);
			this.parentSocket = socket;
			this.encoder = new OpusEncoder(this.config.codec.sampleRate, this.config.codec.channels, this.config.codec.app, this.config.codec.frameDuration);
			var _this = this;

			this._makeStream = function(onError) {
				navigator.getUserMedia({ audio: true }, function(stream) {
					_this.stream = stream;
					_this.audioInput = audioContext.createMediaStreamSource(stream);
					_this.gainNode = audioContext.createGain();
					_this.recorder = audioContext.createScriptProcessor(_this.config.codec.bufferSize, 1, 1);

					_this.recorder.onaudioprocess = function(e) {
						var resampled = _this.sampler.resampler(e.inputBuffer.getChannelData(0));
						var packets = _this.encoder.encode_float(resampled);
						for (var i = 0; i < packets.length; i++) {
							if (_this.socket.readyState == 1) _this.socket.send(packets[i]);
						}
					};

					_this.audioInput.connect(_this.gainNode);
					_this.gainNode.connect(_this.recorder);
					_this.recorder.connect(audioContext.destination);
				}, onError || _this.onError);
			}
		}
	};

	WSAudioAPI.Streamer.prototype.start = function(onError) {
		var _this = this;

		if (!this.parentSocket) {
			this.socket = new WebSocket(this.config.server.host);
		} else {
			this.socket = this.parentSocket;
		}

        this.socket.binaryType = 'arraybuffer';  // <-- ВАЖНО: установите тип бинарных данных

		if (this.socket.readyState == WebSocket.OPEN) {
			this._makeStream(onError);
		} else if (this.socket.readyState == WebSocket.CONNECTING) {
			var _onopen = this.socket.onopen;

			this.socket.onopen = function() {
				if (_onopen) {
					_onopen();
				}
				_this._makeStream(onError);
			}
		} else {
			console.error('Socket is in CLOSED state');
		}

		var _onclose = this.socket.onclose;

		this.socket.onclose = function(event) {
			if (_onclose) {
				_onclose(event);
			}
			if (_this.audioInput) {
				_this.audioInput.disconnect();
				_this.audioInput = null;
			}
			if (_this.gainNode) {
				_this.gainNode.disconnect();
				_this.gainNode = null;
			}
			if (_this.recorder) {
				_this.recorder.disconnect();
				_this.recorder = null;
			}
			_this.stream.getTracks()[0].stop();
			console.log('Disconnected from server', event.reason);
		};
	};

	WSAudioAPI.Streamer.prototype.mute = function() {
		this.gainNode.gain.value = 0;
		console.log('Mic muted');
	};

	WSAudioAPI.Streamer.prototype.unMute = function() {
		this.gainNode.gain.value = 1;
		console.log('Mic unmuted');
	};

	WSAudioAPI.Streamer.prototype.onError = function(e) {
		var error = new Error(e.name);
		error.name = 'NavigatorUserMediaError';
		throw error;
	};

	WSAudioAPI.Streamer.prototype.stop = function() {
		if (this.audioInput) {
			this.audioInput.disconnect();
			this.audioInput = null;
		}
		if (this.gainNode) {
			this.gainNode.disconnect();
			this.gainNode = null;
		}
		if (this.recorder) {
			this.recorder.disconnect();
			this.recorder = null;
		}
		this.stream.getTracks()[0].stop()

		if (!this.parentSocket) {
			this.socket.close();
		}
	};

	WSAudioAPI.Player.prototype.start = function() {
		var _this = this;

		// Play a blank sound to request permission to use speakers
		var buffer = audioContext.createBuffer(1, 1, 22050);
		var node = audioContext.createBufferSource();
		node.buffer = buffer;
		node.connect(audioContext.destination);
		node.start(0);

		this.audioQueue = {
			buffer: new Float32Array(0),

			write: function(newAudio) {
				var currentQLength = this.buffer.length;
				newAudio = _this.sampler.resampler(newAudio);
				var newBuffer = new Float32Array(currentQLength + newAudio.length);
				newBuffer.set(this.buffer, 0);
				newBuffer.set(newAudio, currentQLength);
				this.buffer = newBuffer;
			},

			read: function(nSamples) {
				var samplesToPlay = this.buffer.subarray(0, nSamples);
				this.buffer = this.buffer.subarray(nSamples, this.buffer.length);
				return samplesToPlay;
			},

			length: function() {
				return this.buffer.length;
			}
		};

		this.scriptNode = audioContext.createScriptProcessor(this.config.codec.bufferSize, 1, 1);
		this.scriptNode.onaudioprocess = function(e) {
			if (_this.audioQueue.length()) {
				e.outputBuffer.getChannelData(0).set(_this.audioQueue.read(_this.config.codec.bufferSize));
			} else {
				e.outputBuffer.getChannelData(0).set(_this.silence);	//echopodavlenie
			}
		};
		this.gainNode = audioContext.createGain();
		this.scriptNode.connect(this.gainNode);
		this.gainNode.connect(audioContext.destination);

		if (!this.parentSocket) {
			this.socket = new WebSocket(this.config.server.host);
		} else {
			this.socket = this.parentSocket;
		}
        var _onmessage = this.parentOnmessage = this.socket.onmessage;
		this.socket.onmessage = function(message) {
			if (_onmessage) {
				_onmessage(message);
			}
			if (message.data instanceof Blob) {
				var reader = new FileReader();
				reader.onload = function() {
					_this.audioQueue.write(_this.decoder.decode_float(reader.result));
				};
				reader.readAsArrayBuffer(message.data);
			} else if (message.data instanceof ArrayBuffer) {
				_this.audioQueue.write(_this.decoder.decode_float(message.data));
			}
		};
	};

	WSAudioAPI.Player.prototype.getVolume = function() {
		return this.gainNode ? this.gainNode.gain.value : 'Stream not started yet';
	};

	WSAudioAPI.Player.prototype.setVolume = function(value) {
		if (this.gainNode) this.gainNode.gain.value = value;
	};

	WSAudioAPI.Player.prototype.stop = function() {
		this.audioQueue = null;
		this.scriptNode.disconnect();
		this.scriptNode = null;
		this.gainNode.disconnect();
		this.gainNode = null;

		if (!this.parentSocket) {
			this.socket.close();
		} else {
			this.socket.onmessage = this.parentOnmessage;
		}
	};

})(window);
