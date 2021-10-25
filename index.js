
function hasEventMatch(subscriptionList, eventName) {
	return !subscriptionList || subscriptionList.some(pat => pat instanceof RegExp ? pat.test(eventName) : pat === eventName);
}

class SSEChannel {

	constructor(options) {
		this.options = Object.assign({}, {
			pingInterval: 3000,
			maxStreamDuration: 30000,
			clientRetryInterval: 1000,
			startId: 1,
			historySize: 100,
			rewind: 0
		}, options);

		this.nextID = this.options.startId;
		this.clients = new Set();
		this.messages = [];
		this.active = true;

		if (this.options.pingInterval) {
			this.pingTimer = setInterval(() => this.publish(), this.options.pingInterval);
		}
	}

	publish(data, eventName) {
		if (!this.active) throw new Error('Channel closed');
		let output;
		let id;
		if (!data && !eventName) {
			if (!this.clients.size) return; // No need to create a ping entry if there are no clients connected
			output = "data: \n\n";
		} else {
			id = this.nextID++;
			if (typeof data === "object") data = JSON.stringify(data);
			data = data ? data.split(/[\r\n]+/).map(str => 'data: '+str).join('\n') : '';
			output = (
				"id: " + id + "\n" +
				(eventName ? "event: " + eventName + "\n" : "") +
				(data || "data: ") + '\n\n'
			);
			this.messages.push({ id, eventName, output });
		}

		[...this.clients].filter(c => !eventName || hasEventMatch(c.events, eventName)).forEach(c => c.res.write(output));

		while (this.messages.length > this.options.historySize) {
			this.messages.shift();
		}

		return id;
	}

	subscribe(req, res, events) {
		if (!this.active) throw new Error('Channel closed');
		const c = {req, res, events};
		c.req.socket.setNoDelay(true);
		c.res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "s-maxage="+(Math.floor(this.options.maxStreamDuration/1000)-1)+"; max-age=0; stale-while-revalidate=0; stale-if-error=0",
			"Connection": "keep-alive"
		});
		let body = "retry: " + this.options.clientRetryInterval + '\n\n';

		const lastID = Number.parseInt(req.headers['last-event-id'], 10);
		const rewind = (!Number.isNaN(lastID)) ? ((this.nextID-1)-lastID) : this.options.rewind;
		if (rewind) {
			this.messages.filter(m => hasEventMatch(c.events, m.eventName)).slice(0-rewind).forEach(m => {
				body += m.output
			});
		}

		c.res.write(body);
		this.clients.add(c);

		setTimeout(() => {
			if (!c.res.finished) {
				this.unsubscribe(c);
			}
		}, this.options.maxStreamDuration);
		c.res.on('close', () => this.unsubscribe(c));
		return c;
	}

	unsubscribe(c) {
		c.res.end();
		this.clients.delete(c);
	}

	close() {
		this.clients.forEach(c => c.res.end());
		this.clients = new Set();
		this.messages = [];
		if (this.pingTimer) clearInterval(this.pingTimer);
		this.active = false;
	}

	listClients() {
		const rollupByIP = {};
		this.clients.forEach(c => {
			const ip = c.req.connection.remoteAddress;
			if (!(ip in rollupByIP)) {
				rollupByIP[ip] = 0;
			}
			rollupByIP[ip]++;
		});
		return rollupByIP;
	}

	getSubscriberCount() {
		return this.clients.size;
	}
};

export default SSEChannel;