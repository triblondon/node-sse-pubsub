
import { expect}  from 'chai';

import fetch from 'node-fetch';
import http from 'http';
import SSEChannel from '../index.js';

const PORT = process.env.PORT || 3102;
const URL = "http://localhost:"+PORT+"/stream";

const setupServer = (() => {
	let app, server, sockets;
	return async (sseOptions, subsOptions) => {
		return new Promise(resolve => {
			if (server) {
				sockets.forEach(s => s.destroy());
				server.close(() => {
					server = null;
					resolve(setupServer(sseOptions, subsOptions));
				});
			} else {
				const sse = new SSEChannel(sseOptions);
				sockets = [];
				server = http.createServer((req, res) => {
					if (req.url == '/stream') sse.subscribe(req, res, subsOptions);
				});
				server.listen(PORT, () => resolve(sse));
				server.on('connection', s => sockets.push(s));
			}
		});
	};
})();

const nextChunk = async body => {
	return new Promise(resolve => {
		body.on('data', chunk => resolve(chunk.toString()));
	});
};

const measureTime = async pr => {
	const start = Date.now();
	await pr;
	const end = Date.now();
	return end - start;
};


describe('SSEChannel', function () {

	it('should return 200 OK status', async function () {
		const sse = await setupServer();
    let res = await fetch(URL);
    expect(res.status).to.equal(200);
		sse.close();
	});

	it('should have correct content-type', async function () {
		const sse = await setupServer();
		let res = await fetch(URL);
    expect(res.headers.get('content-type')).to.equal('text/event-stream');
		sse.close();
	});

	it('should be server-cachable for the duration of the stream', async function () {
		const sse = await setupServer({maxStreamDuration:20000});
		let res = await fetch(URL);
    expect(res.headers.get('cache-control')).to.contain('s-maxage=19');
		sse.close();
	});

	it('should not be client-cachable', async function () {
		const sse = await setupServer({maxStreamDuration:20000});
		let res = await fetch(URL);
    expect(res.headers.get('cache-control')).to.contain('max-age=0');
		sse.close();
	});

	it('should include retry in first response chunk', async function () {
		let sse, res, chunk;
		sse = await setupServer();
		res = await fetch(URL);
		chunk = await nextChunk(res.body);
		expect(chunk).to.match(/retry:\s*\d{4,6}\n/);
		sse.close();

		sse = await setupServer({clientRetryInterval:1234});
		res = await fetch(URL);
		chunk = await nextChunk(res.body);
		expect(chunk).to.match(/retry:\s*1234\n/);
		sse.close();
	});

	it('should close the connection at maxStreamDuration', async function () {
		const sse = await setupServer({maxStreamDuration:1500});
		let elapsed = await measureTime(fetch(URL).then(res => res.text()));
		expect(elapsed).to.be.approximately(1500, 30);
		sse.close();
	});

	it('should return an ID from publish', async function () {
		let sse, res, output, firstID, secondID, matches;
		sse = await setupServer();
		res = await fetch(URL);
		await nextChunk(res.body);
		firstID = sse.publish('first');
		output = await nextChunk(res.body);
		expect((new RegExp(`id:\\s*${firstID}\\b`)).test(output)).to.be.true;
		secondID = sse.publish('second');
		output = await nextChunk(res.body);
		expect((new RegExp(`id:\\s*${secondID}\\b`)).test(output)).to.be.true;
		expect(secondID).to.equal(firstID+1);
		sse.close();
	});

	it('should start at startId', async function () {
		let sse, res, output;
		sse = await setupServer();
		res = await fetch(URL);
		await nextChunk(res.body);
		sse.publish('something');
		output = await nextChunk(res.body);
		expect(output).to.match(/id:\s*1\n/);
		expect(output).to.match(/data:\s*something\n/);
		sse.publish('something else');
		output = await nextChunk(res.body);
		expect(output).to.match(/id:\s*2\n/);
		expect(output).to.match(/data:\s*something else\n/);
		sse.close();

		sse = await setupServer({startId: 8777});
		res = await fetch(URL);
		await nextChunk(res.body);
		sse.publish('something');
		output = await nextChunk(res.body);
		expect(output).to.match(/id:\s*8777\n/);
		expect(output).to.match(/data:\s*something\n/);
		sse.close();
	});

	it('should ping at pingInterval', async function () {
		const sse = await setupServer({pingInterval:500});
		let res = await fetch(URL);
		await nextChunk(res.body)
		let chunkPromise = nextChunk(res.body);
		let elapsed = await measureTime(chunkPromise);
		let output = await chunkPromise;
		expect(elapsed).to.be.approximately(500, 30);
		expect(output).to.match(/data:\s*\n\n/);
		expect(output).to.not.contain('event:');
		expect(output).to.not.contain('id:');
		sse.close();
	});

	it('should output a retry number', async function () {
		const sse = await setupServer({clientRetryInterval:4321});
		let res = await fetch(URL);
		let chunk = await nextChunk(res.body);
		expect(chunk).to.match(/retry:\s*4321\n\n/);
		sse.close();
	});

	it('should include event name if specified', async function () {
		let chunk;
		let sse = await setupServer();
		let res = await fetch(URL);
		await nextChunk(res.body)
		sse.publish('no-event-name');
		chunk = await nextChunk(res.body);
		expect(chunk).to.not.contain('event:');
		sse.publish('with-event-name', 'myEvent');
		chunk = await nextChunk(res.body);
		expect(chunk).to.match(/event:\s*myEvent\n/);
		sse.close();
	});

	it('should include only events the subscriber has specified', async function () {
		let chunk;
		let sse = await setupServer({ pingInterval: 500 }, ['event-1']);
		let res = await fetch(URL);
		await nextChunk(res.body)
		sse.publish('foo', 'event-1');
		sse.publish('bar', 'event-2');
		chunk = await nextChunk(res.body);
		expect(chunk).to.contain('event-1');
		expect(chunk).to.not.contain('event-2');
		sse.publish('baz', 'event-3');
		chunk = await nextChunk(res.body);
		expect(chunk).to.not.contain('event-3');
		sse.close();
	});

	it('should include previous events if last-event-id is specified', async function () {
		let sse = await setupServer();
		for (let i=1; i<=10; i++) {
			sse.publish('event-'+i);
		}
		let res = await fetch(URL, {headers: {'Last-Event-ID': 4}});
		let output = await nextChunk(res.body);
		let events = output.split('\n\n').filter(str => str.includes('id:'));
		expect(events.length).to.equal(6);
		expect(events[0]).to.match(/id:\s*5\n/);
		sse.close();
	});

	it('should limit history length to historySize', async function () {
		let sse = await setupServer({historySize:5});
		for (let i=1; i<=10; i++) {
			sse.publish('event-'+i);
		}
		let res = await fetch(URL, {headers: {'Last-Event-ID': 2}});
		let output = await nextChunk(res.body);
		let events = output.split('\n\n').filter(str => str.includes('id:'));
		expect(events.length).to.equal(5);
		expect(events[0]).to.match(/id:\s*6\n/);
		sse.close();
	});

	it('should serialise non scalar values as JSON', async function () {
		let testdata = {foo:42};
		let sse = await setupServer();
		let res = await fetch(URL);
		await nextChunk(res.body);
		sse.publish(testdata);
		let chunk = await nextChunk(res.body);
		expect(chunk).to.contain(JSON.stringify(testdata));
		sse.close();
	});

	it('should list connected clients by IP address', async function () {
		let sse = await setupServer();
		let res1 = await fetch(URL);
		let res2 = await fetch(URL);
		expect(sse.listClients()).to.eql({
			'::ffff:127.0.0.1': 2
		});
		sse.close();
	});

	it('should count connected clients', async function () {
		let sse = await setupServer();
		let res1 = await fetch(URL);
		let res2 = await fetch(URL);
		expect(sse.getSubscriberCount()).to.equal(2);
		sse.close();
	});

	it('should understand the rewind option', async function () {
		let sse, res, output;
		sse = await setupServer({rewind: 2});
		sse.publish('message-1');
		sse.publish('message-2');
		sse.publish('message-3');
		res = await fetch(URL);
		output = await nextChunk(res.body);
		expect(output).to.not.include('message-1');
		expect(output).to.include('message-2');
		expect(output).to.include('message-3');
		sse.close();

		sse = await setupServer({rewind: 6});
		sse.publish('message-1');
		sse.publish('message-2');
		sse.publish('message-3');
		res = await fetch(URL);
		output = await nextChunk(res.body);
		expect(output).to.include('message-1');
		expect(output).to.include('message-2');
		expect(output).to.include('message-3');
		sse.close();
	});

	it('should stop pinging and hang up when the stream is closed', async function () {
		let sse, res;
		let hasEnded = false;
		sse = await setupServer();
		res = await fetch(URL);
		sse.close();
		let respEndPromise = res.text();
		let elapsed = await measureTime(respEndPromise);
		expect(elapsed).to.be.lessThan(100, 30);
	});

});
