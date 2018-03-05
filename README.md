# Server-sent events for NodeJS

A simple NodeJS module to generate Server-Sent-Events streams with a publish/subscribe interface and simple integration with either Node's built in HTTP library or any framework that exposes it, eg. [ExpressJS](https://expressjs.com).

## Usage

Install with `npm i sse-pubsub`, then, if you are using Express:

```javascript
const express = require('express');
const SSEChannel = require('sse-pubsub');

const app = express();
const channel = new SSEChannel();

// Say hello every second
setInterval(() => channel.publish("Hello everyone!", 'myEvent'), 1000);

app.get('/stream', (req, res) => channel.subscribe(req, res));

app.listen(3000);
```

You should now be able to visit `http://localhost:3000/stream` and see a sequence of 'Hello everyone!' events appearing once per second.

To subscribe to the stream from client-side JavaScript:

```javascript
const es = new EventSource("/stream");
es.addEventListener('myEvent', ev => {
	alert(ev.data);
});
```

A more detailed demo lives in `/demo/` and can be run with `npm start` if the module is checked out for development (see [development](#development)).

## API

### `SSEChannel(options)` (constructor)

Creates a new `SSEChannel`.  Available options are:

* `pingInterval` (integer): Interval at which to send pings (no-op events).  Milliseconds, default is 3000, set to a falsy value to disable pings entirely.
* `maxStreamDuration` (integer): Maximum amoiunt of time to allow a client to remain connected before closing the connection.  SSE streams are expected to disconnect regularly to avoid zombie clients and problems with misbehaving middleboxes and proxies.  Milliseconds, default is 30000.
* `clientRetryInterval` (integer): Amount of time clients should wait before reconencting, if they become disconnected from the stream. Milliseconds, default is 1000.
* `startId` (integer): ID to use for the first message on the channel.  Default is 1.
* `historySize` (integer): Number of messages to keep in memory, allowing for clients to use the `Last-Event-ID` header to request events that occured before they joined the stream.  Default is 100.
* `rewind` (integer): Number of messages to backtrack by default when serving a new subscriber that does not include a `Last-Event-ID` in their request. If request includes `Last-Event-ID`, the `rewind` option is ignored.

```javascript
const channel = new SSEChannel({
	pingInterval: 10000,
	startId: 1330
});
```

### `subscribe(req, res)`

Attaches an inbound HTTP request to an SSE channel.  Usually used in conjuction with a framework like Express.  Returns a reference for the client.

* `req`: A NodeJS `IncomingMessage` object or anything that inherits from it
* `res`: A NodeJS `ServerResponse` object or anything that inherits from it

```javascript
const channel = new SSEChannel();
app.get('/stream', (req, res) => channel.subscribe(req, res));
```

### `publish(data, [eventName])`

Publishes a new event to all subscribers to the channel.

* `data` (any): Message to send.  If a primitive value, will be sent as-is, otherwise will be passed through `JSON.stringify`.
* `eventName` (string): Event name to assign to the event.

Since all events published to a channel will be sent to all subscribers to that channel, if you want to filter events that are of interest to only a subset of users, it makes sense to use multiple separate channel instances.  However, `eventName` is useful if you are sending events that are all relevant to all subscribers, but might need to be processed by different client-side handlers.  Event names can therefore be considered to be like method names of a method that you are invoking in the client-side code.

Returns the ID of the new message.

### `unsubscribe(clientRef)`

Detaches an active HTTP connection from the channel.

* `clientRef` (object): A reference to an object obtained by calling the `subscribe` method.

### `listClients()`

Returns an object where the keys are the remote addresses of each connected client, and the values are the number of connections from that address.

```javascript
console.log(channel.listClients());
// {
//  '::ffff:127.0.0.1': 2
// }
```

### `getSubscriberCount()`

Returns the number of currently connected clients.

## Development

To develop on the project, clone the repo and run `npm install`.  Then if you want to run the demo server:

1. `npm start`
2. Open `http://127.0.0.1:3101` in your browser

To run the tests, `npm test`.  The project uses Express for the demo server and Mocha and Chai for the tests, however none of these are needed in production. The tests use Node's raw http library rather than express to ensure there is not any accidental dependence on request or response properties added by Express.

## Licence

MIT.
