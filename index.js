module.exports = class SSEChannel {

	constructor(options) {
		this.options = Object.assign({}, {
			pingInterval: 3000,
			maxStreamDuration: 30000,
			clientRetryInterval: 1000,
			startId: 1,
			historySize: 100
		}, options);

		this.msgID = this.options.startId;
		this.clients = new Set();
		this.messages = [];

		if (this.options.pingInterval) {
			this.pingTimer = setInterval(() => this.publish(), this.options.pingInterval);
		}
	}

	publish(data, eventName) {
		const thisID = this.msgID++;
		if (typeof data === "object") data = JSON.stringify(data);
		data = data ? data.split(/[\r\n]+/).map(str => 'data: '+str).join('\n') : '';

		const output = (
			(data ? "id: " + thisID + "\n" : "") +
			(eventName ? "event: " + eventName + "\n" : "") +
			(data || "data: ") + '\n\n'
		);
		this.clients.forEach(c => c.res.write(output));

		this.messages.push(output);
		while (this.messages.length > this.options.historySize) {
			this.messages.shift();
		}
	}

	subscribe(req, res) {
		const c = {req, res};
		c.req.socket.setNoDelay(true);
		c.res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "s-maxage="+(Math.floor(this.options.maxStreamDuration/1000)-1)+"; max-age=0; stale-while-revalidate=0; stale-if-error=0",
			"Connection": "keep-alive"
		});
		let body = "retry: " + this.options.clientRetryInterval + '\n\n';

		const lastID = Number.parseInt(req.headers['last-event-id']);
		if (!Number.isNaN(lastID)) {
			const rewind = -(this.msgID-lastID-1);
			this.messages.slice(rewind).forEach(output => {
				body += output
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
