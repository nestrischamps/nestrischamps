const worker_script = `
	idMap = {};
	onmessage = e => {
		const [cmd, ...args] = e.data;
		if (cmd === 'setInterval') {
			const [interval, callid] = args;
			idMap[callid] = setInterval(() => {
				postMessage(['interval', callid]);
			}, interval);
		}
		else if (cmd === 'clearInterval') {
			const [callid] = args;
			delete idMap[callid];
			clearInterval(callid);
		}
	};
	postMessage(['init']);
`;

export const timer = {
	callid: 0,
	callbacks: {},
	worker: null,
	setInterval: function (callback, ms) {
		if (!this.worker) {
			return setInterval(callback, ms);
		}
		this.callbacks[++this.callid] = callback;
		this.worker.postMessage(['setInterval', ms, this.callid]);
		return this.callid;
	},
	clearInterval: function (id) {
		if (!this.worker) {
			return clearInterval(id);
		}
		delete this.callbacks[id];
		this.worker.postMessage(['clearInterval', id]);
	},
	init: function () {
		return new Promise(resolve => {
			const blob = new Blob([worker_script], { type: 'text/javascript' });
			this.worker = new Worker(window.URL.createObjectURL(blob));

			const handleWorkerMessage = e => {
				const [cmd, ...args] = e.data;
				if (cmd === 'interval') {
					const [callid] = args;
					this.callbacks[callid]?.();
				}
			};

			const handleWorkerInit = () => {
				this.worker.removeEventListener('message', handleWorkerInit);
				this.worker.addEventListener('message', handleWorkerMessage);
				resolve();
			};

			// by convention the first message is guaranteed to be the init message, so we don't need to check the details
			this.worker.addEventListener('message', handleWorkerInit);
		});
	},
};

export function sleep(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}
