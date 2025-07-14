import Fastify from 'fastify';
import { createClient } from 'redis';
import { Kafka } from 'kafkajs';

const server = Fastify({ logger: true });

const redisClient = createClient({ url: 'redis://redis:6379' });
redisClient.on('error', (err) => server.log.error('Redis Client Error', err));

const kafka = new Kafka({
    clientId: 'rating-service',
    brokers: ['kafka:29092']
});

const consumeOrderEvents = async () => {
    server.log.info('Attempting to create Kafka consumer...');
    const consumer = kafka.consumer({ groupId: 'rating-group' });

    consumer.on(consumer.events.CONNECT, () => {
        server.log.info('Kafka Consumer: CONNECTED SUCCESSFULLY');
    });
    consumer.on(consumer.events.DISCONNECT, () => {
        server.log.warn('Kafka Consumer: DISCONNECTED');
    });
    consumer.on(consumer.events.CRASH, ({ payload }) => {
        server.log.error('Kafka Consumer: CRASHED', payload.error);
    });

    server.log.info('Attempting to connect Kafka consumer...');
    await consumer.connect();

    server.log.info('Attempting to subscribe to "order-created" topic...');
    await consumer.subscribe({ topic: 'order-created', fromBeginning: true });
    server.log.info('Kafka consumer subscribed successfully to "order-created". Waiting for messages...');

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            if (!message.value) return;
            const orderEvent = JSON.parse(message.value.toString());
            server.log.info(`---> EVENT RECEIVED: ${JSON.stringify(orderEvent)}`);
            await redisClient.set(orderEvent.order_id, JSON.stringify({ rating: null }));
        },
    });
};

const start = async () => {
    try {
        server.log.info('Connecting to Redis...');
        await redisClient.connect();
        server.log.info('Redis client connected.');

        consumeOrderEvents().catch(err => {
            server.log.error('!!! Kafka consumer failed to start !!!', err);
            process.exit(1);
        });

        await server.listen({ port: 8001, host: '0.0.0.0' });
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

server.get('/', async (request, reply) => {
    return { status: 'OK', message: 'Rating Service is running' };
});

start();