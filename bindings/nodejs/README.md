# Node.js Bindings for rust-oci-client

Node.js bindings for the [rust-oci-client](https://github.com/oras-project/rust-oci-client) library, providing high-performance OCI Distribution client functionality.

## Features

- **Pure API Mirror**: Function signatures match the native Rust functions exactly
- **High Performance**: Uses NAPI-RS for zero-copy data transfer where possible
- **Full Auth Support**: Anonymous, Basic (username/password), and Bearer token authentication
- **Complete ClientConfig**: All native configuration options exposed
- **TypeScript Support**: Full type definitions included

## Installation

```bash
npm install @dfatwork-pkgs/oci-client
# or
yarn add @dfatwork-pkgs/oci-client
```

## Usage

```typescript
import { OciClient, anonymousAuth, basicAuth } from '@dfatwork-pkgs/oci-client';

// Create a client with default configuration
const client = new OciClient();

// Or with custom configuration
const clientWithConfig = OciClient.withConfig({
  protocol: 'Https',
  acceptInvalidCertificates: false,
  maxConcurrentDownload: 8,
  maxConcurrentUpload: 8,
});

// Pull an image
const imageData = await client.pull(
  'ghcr.io/example/image:latest',
  anonymousAuth(),
  ['application/vnd.oci.image.layer.v1.tar+gzip']
);

console.log(`Pulled ${imageData.layers.length} layers`);
console.log(`Digest: ${imageData.digest}`);

// Push an image
const response = await client.push(
  'registry.example.com/myimage:v1',
  layers,
  config,
  basicAuth('username', 'password'),
  null // Let the client generate the manifest
);

console.log(`Manifest URL: ${response.manifestUrl}`);

// Pull image manifest
const { manifest, digest } = await client.pullImageManifest(
  'ghcr.io/example/image:latest',
  anonymousAuth()
);

// Push a manifest list (multi-platform image)
const manifestUrl = await client.pushManifestList(
  'registry.example.com/myimage:v1',
  basicAuth('username', 'password'),
  imageIndex
);

// Pull referrers (OCI 1.1)
const referrers = await client.pullReferrers(
  'ghcr.io/example/image@sha256:abc123...',
  'application/vnd.example.sbom'
);
```

## API Reference

### Client

#### `new OciClient()`
Create a client with default configuration.

#### `OciClient.withConfig(config: ClientConfig)`
Create a client with custom configuration.

### Authentication

#### `anonymousAuth()`
Create anonymous authentication.

#### `basicAuth(username: string, password: string)`
Create HTTP Basic authentication.

#### `bearerAuth(token: string)`
Create Bearer token authentication.

### Main Functions

#### `pull(image, auth, acceptedMediaTypes)`
Pull an image from the registry. Returns `ImageData` with layers as Buffers.

#### `push(imageRef, layers, config, auth, manifest?)`
Push an image to the registry. Returns `PushResponse`.

#### `pullImageManifest(image, auth)`
Pull an image manifest. Returns `{ manifest, digest }`.

#### `pushManifestList(reference, auth, manifest)`
Push a manifest list (image index). Returns manifest URL.

#### `pullReferrers(image, artifactType?)`
Pull referrers for an artifact. Returns `ImageIndex`.

### Types

See the TypeScript definitions for complete type information.

## Building from Source

```bash
# Install dependencies
yarn install

# Build native module (release)
yarn build

# Build debug version
yarn build:debug

# Run tests
yarn test

# Lint
yarn lint
```

## Supported Platforms

- Windows x64 (MSVC)
- macOS x64 (Intel)
- macOS ARM64 (Apple Silicon)
- Linux x64 (glibc)
- Linux ARM64 (glibc)
- Linux x64 (musl/Alpine)
- Linux ARM64 (musl/Alpine)

## License

Apache-2.0
