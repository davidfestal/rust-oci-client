/**
 * Tests for Folder Artifact Push/Pull
 *
 * This test demonstrates pushing a folder as a tar.gz OCI artifact
 * and pulling it back with automatic extraction, using:
 * - The high-level push() and pull() methods
 * - Streaming/pipes to avoid temp files
 * - Annotations for filename and strip-components
 * - Automatic folder naming from artifact filename
 */

import test from 'ava'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { buffer } from 'stream/consumers'
import * as tar from 'tar'
import * as os from 'os'

import {
  OciClient,
  anonymousAuth,
  type ImageData,
  IMAGE_LAYER_GZIP_MEDIA_TYPE,
  ORG_OPENCONTAINERS_IMAGE_TITLE,
} from '../index.js'

import { ZotRegistry, shouldSkipZotTests } from './zot-registry.js'

// Annotations for folder artifacts
const ANNOTATION_FILENAME = ORG_OPENCONTAINERS_IMAGE_TITLE
const ANNOTATION_STRIP_COMPONENTS = 'io.oci-client.tar.strip-components'
const LAYER_MEDIA_TYPE = IMAGE_LAYER_GZIP_MEDIA_TYPE
const CONFIG_MEDIA_TYPE = 'application/vnd.oci.empty.v1+json' // Not in standard constants

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Push a folder as an OCI artifact using the high-level push() method
 */
async function pushFolderAsArtifact(
  client: OciClient,
  folderPath: string,
  imageRef: string,
  stripComponents: number = 1
): Promise<{ configUrl: string; manifestUrl: string }> {
  const folderName = path.basename(folderPath)
  const tarGzFilename = `${folderName}.tar.gz`

  const response = await client.push(
    imageRef,
    [
      {
        mediaType: LAYER_MEDIA_TYPE,
        annotations: {
          [ANNOTATION_FILENAME]: tarGzFilename,
          [ANNOTATION_STRIP_COMPONENTS]: stripComponents.toString(),
        },
        data: await buffer(
          tar.create(
            {
              gzip: true,
              cwd: path.dirname(folderPath),
              portable: true,
            },
            [path.basename(folderPath)]
          )
        ),
      },
    ],
    {
      data: Buffer.from('{}'),
      mediaType: CONFIG_MEDIA_TYPE,
    },
    anonymousAuth()
  )

  return response
}

/**
 * Pull an artifact and extract to folder using the high-level pull() method
 */
async function pullArtifactAsFolder(
  client: OciClient,
  imageRef: string,
  outputDir: string
): Promise<{ folderPath: string; stripComponents: number; imageData: ImageData }> {
  const imageData = await client.pull(imageRef, anonymousAuth(), [LAYER_MEDIA_TYPE])

  if (imageData.layers.length === 0) {
    throw new Error('No layers in pulled image')
  }

  const layer = imageData.layers[0]

  const manifestLayer = imageData.manifest?.layers?.[0]
  const filename = manifestLayer?.annotations?.[ANNOTATION_FILENAME] || 'artifact.tar.gz'
  const stripComponents = parseInt(manifestLayer?.annotations?.[ANNOTATION_STRIP_COMPONENTS] || '0', 10)

  let folderName = filename
  if (folderName.endsWith('.tar.gz')) folderName = folderName.slice(0, -7)
  else if (folderName.endsWith('.tgz')) folderName = folderName.slice(0, -4)

  const extractPath = path.join(outputDir, folderName)

  await fs.promises
    .mkdir(extractPath, { recursive: true })
    .then(() =>
      pipeline(Readable.from(layer.data), tar.x({ gzip: true, cwd: extractPath, strip: stripComponents }))
    )

  return { folderPath: extractPath, stripComponents, imageData }
}

// =============================================================================
// Tests
// =============================================================================

const skipZot = shouldSkipZotTests()

const zot = new ZotRegistry()
let client: OciClient
let testDir: string

if (!skipZot) {
  test.before(async () => {
    await zot.start()
    client = zot.createClient()
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oci-artifact-test-'))
  })

  test.after(async () => {
    await zot.stop()
    if (testDir) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })
}

const zotTest = skipZot ? test.skip : test.serial

// Test folder setup
let sourceFolder: string
let imageRef: string
const testFolderName = 'my-app-config'

if (!skipZot) {
  test.serial.before(() => {
    sourceFolder = path.join(testDir, testFolderName)
    fs.mkdirSync(sourceFolder, { recursive: true })

    fs.writeFileSync(
      path.join(sourceFolder, 'config.json'),
      JSON.stringify(
        {
          name: 'my-app',
          version: '1.0.0',
          settings: { debug: true },
        },
        null,
        2
      )
    )

    fs.writeFileSync(path.join(sourceFolder, 'README.md'), '# My App Config\n\nThis is a test.\n')

    const subdir = path.join(sourceFolder, 'templates')
    fs.mkdirSync(subdir)
    fs.writeFileSync(path.join(subdir, 'main.tmpl'), 'Hello {{ .Name }}!')
    fs.writeFileSync(path.join(subdir, 'error.tmpl'), 'Error: {{ .Message }}')

    imageRef = zot.repo(`artifact-test:folder-${Date.now()}`)
  })
}

zotTest('should push folder using push() method', async (t) => {
  const { configUrl, manifestUrl } = await pushFolderAsArtifact(client, sourceFolder, imageRef, 1)

  t.truthy(configUrl)
  t.truthy(manifestUrl)
  t.true(manifestUrl.includes(zot.address))
})

zotTest('should pull folder using pull() method with correct annotations', async (t) => {
  const outputDir = path.join(testDir, 'extracted')
  fs.mkdirSync(outputDir, { recursive: true })

  const { folderPath, stripComponents, imageData } = await pullArtifactAsFolder(client, imageRef, outputDir)

  t.is(imageData.layers.length, 1)
  t.true(imageData.config.data instanceof Buffer)
  t.truthy(imageData.manifest)

  t.is(imageData.manifest?.layers?.[0].annotations?.[ANNOTATION_FILENAME], `${testFolderName}.tar.gz`)
  t.is(stripComponents, 1)

  t.is(path.basename(folderPath), testFolderName)
  t.true(fs.existsSync(folderPath))
})

zotTest('should extract with correct directory structure', async (t) => {
  const outputDir = path.join(testDir, 'extracted2')
  fs.mkdirSync(outputDir, { recursive: true })

  const { folderPath } = await pullArtifactAsFolder(client, imageRef, outputDir)

  t.true(fs.existsSync(path.join(folderPath, 'config.json')))
  t.true(fs.existsSync(path.join(folderPath, 'README.md')))
  t.true(fs.existsSync(path.join(folderPath, 'templates', 'main.tmpl')))
  t.true(fs.existsSync(path.join(folderPath, 'templates', 'error.tmpl')))

  const config = JSON.parse(fs.readFileSync(path.join(folderPath, 'config.json'), 'utf8'))
  t.is(config.name, 'my-app')
  t.is(config.version, '1.0.0')

  const template = fs.readFileSync(path.join(folderPath, 'templates', 'main.tmpl'), 'utf8')
  t.is(template, 'Hello {{ .Name }}!')
})

zotTest('should handle folders with binary files', async (t) => {
  const folderPath = path.join(testDir, 'binary-content')
  fs.mkdirSync(folderPath, { recursive: true })

  const binaryData = crypto.randomBytes(10 * 1024)
  fs.writeFileSync(path.join(folderPath, 'data.bin'), binaryData)

  fs.writeFileSync(
    path.join(folderPath, 'manifest.json'),
    JSON.stringify({
      files: ['data.bin'],
      checksum: crypto.createHash('sha256').update(binaryData).digest('hex'),
    })
  )

  const binaryImageRef = zot.repo(`artifact-test:binary-${Date.now()}`)

  const { manifestUrl } = await pushFolderAsArtifact(client, folderPath, binaryImageRef, 1)
  t.truthy(manifestUrl)

  const outputDir = path.join(testDir, 'binary-extracted')
  fs.mkdirSync(outputDir, { recursive: true })

  const { folderPath: extractedPath, imageData } = await pullArtifactAsFolder(client, binaryImageRef, outputDir)

  t.is(imageData.layers.length, 1)
  t.truthy(imageData.digest)

  const extractedBinary = fs.readFileSync(path.join(extractedPath, 'data.bin'))
  t.true(extractedBinary.equals(binaryData))

  const manifest = JSON.parse(fs.readFileSync(path.join(extractedPath, 'manifest.json'), 'utf8'))
  const extractedChecksum = crypto.createHash('sha256').update(extractedBinary).digest('hex')
  t.is(extractedChecksum, manifest.checksum)
})

