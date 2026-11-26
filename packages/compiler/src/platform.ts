/**
 * The only module that imports `@effect/platform-node`. The package build bundles this file, so an
 * installed roadmark does not depend on that package or on the Redis client it lists as a required
 * peer dependency. Everything else imports Node platform services from here.
 */
export type { NodeServices } from '@effect/platform-node/NodeServices';
export { layer as nodeServices } from '@effect/platform-node/NodeServices';
export { runMain } from '@effect/platform-node/NodeRuntime';
export { layerHttpServices, make as makeHttpServer } from '@effect/platform-node/NodeHttpServer';
export { toIncomingMessage } from '@effect/platform-node/NodeHttpServerRequest';
