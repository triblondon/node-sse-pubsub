'use strict';

const express = require('express');
const SSEChannel = require('../index');

const PORT = process.env.PORT || 3101;
const randomIntInRange = (low, high) => Math.floor(Math.random() * high) + low;

const app = express();

// Create SSE channels.  Non-default options can be passed
// as an object and only affect that instance
const sseChannels = {
	'ch1': new SSEChannel(),
	'ch2': new SSEChannel({startId: 3456, pingInterval:5000})
};

// A function to generate some random data and publish it on
// the SSE channels
const publishStuff = () => {
	const randomChannel = sseChannels['ch'+randomIntInRange(1,2)];
	const dataPayload = {newVal: randomIntInRange(0,1000) };

	// Push the data into the channel as an event.  This will generate
	// an SSE event payload and emit it on all the HTTP connections
	// which are subscribed to this SSE channel.
	randomChannel.publish(dataPayload, 'myEvent');

	const randomDelay = randomIntInRange(150,400);
	setTimeout(publishStuff, randomDelay);
}

// Serve the static part of the demo
app.use(express.static(__dirname+'/public'));

// Serve the event streams
app.get('/stream/:channel', (req, res, next) => {

	// If the requested channel doesn't exist, skip this route
	if (!(req.params.channel in sseChannels)) next();

	// Subscribe this request to the requested channel.  The
	// request is now attached to the SSE channel instance and
	// will receive any events published to it.  You don't need
	// to retain any reference to the request yourself.
	sseChannels[req.params.channel].subscribe(req, res);
});

// Return a 404 if no routes match
app.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  res.status(404).end('Not found');
});

app.listen(PORT, () => {
	console.log('Listening on port ' + PORT);
	publishStuff();
});
