import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import { parse } from './parse.js';

const traverse = traverseModule.default ?? traverseModule;

const FINGERPRINT_SIGNATURES = {
  canvas: {
    properties: new Set(['toDataURL', 'getImageData', 'measureText', 'isPointInPath']),
    identifiers: new Set(['HTMLCanvasElement', 'CanvasRenderingContext2D']),
  },
  webgl: {
    properties: new Set([
      'getParameter',
      'getExtension',
      'getSupportedExtensions',
      'UNMASKED_VENDOR_WEBGL',
      'UNMASKED_RENDERER_WEBGL',
      'MAX_TEXTURE_SIZE',
    ]),
    identifiers: new Set(['WebGLRenderingContext', 'WebGL2RenderingContext']),
  },
  audio: {
    properties: new Set([
      'createOscillator',
      'createAnalyser',
      'createDynamicsCompressor',
      'getFloatFrequencyData',
      'getChannelData',
    ]),
    identifiers: new Set(['AudioContext', 'webkitAudioContext', 'OfflineAudioContext']),
  },
  automation: {
    properties: new Set([
      'webdriver',
      '_phantom',
      '__nightmare',
      'callPhantom',
      '__selenium_unwrapped',
      '__webdriver_evaluate',
      '__driver_evaluate',
    ]),
    identifiers: new Set([]),
  },
  hardware: {
    properties: new Set([
      'hardwareConcurrency',
      'deviceMemory',
      'maxTouchPoints',
      'colorDepth',
      'pixelDepth',
      'screenLeft',
      'screenTop',
    ]),
    identifiers: new Set([]),
  },
  sensors: {
    properties: new Set(['getBattery', 'connection', 'networkInformation']),
    identifiers: new Set(['DeviceOrientationEvent', 'DeviceMotionEvent', 'BatteryManager']),
  },
};

const ENDPOINT_REGEX = /^https?:\/\/[^\s"'`]+|^wss?:\/\/[^\s"'`]+|\/(?:telemetry|sensor|collector|beacon|v\d+\/api|event|fingerprint|fp|metrics|verify)\b/i;

/**
 * Scan an AST or source string for browser fingerprinting APIs, automation checks, and endpoints.
 */
export function inspectTelemetry(target) {
  const ast = typeof target === 'string' ? parse(target) : target;

  const findings = {
    canvas: [],
    webgl: [],
    audio: [],
    automation: [],
    hardware: [],
    sensors: [],
  };

  const endpoints = new Set();

  traverse(ast, {
    Identifier(path) {
      const name = path.node.name;
      const line = path.node.loc?.start?.line ?? 0;

      for (const [category, sigs] of Object.entries(FINGERPRINT_SIGNATURES)) {
        if (sigs.identifiers.has(name)) {
          findings[category].push({ type: 'identifier', name, line });
        }
      }
    },
    MemberExpression(path) {
      let propName = null;
      if (!path.node.computed && t.isIdentifier(path.node.property)) {
        propName = path.node.property.name;
      } else if (path.node.computed && t.isStringLiteral(path.node.property)) {
        propName = path.node.property.value;
      }

      if (!propName) return;
      const line = path.node.loc?.start?.line ?? 0;

      for (const [category, sigs] of Object.entries(FINGERPRINT_SIGNATURES)) {
        if (sigs.properties.has(propName)) {
          findings[category].push({ type: 'property', name: propName, line });
        }
      }
    },
    StringLiteral(path) {
      const val = path.node.value;
      if (typeof val === 'string' && val.length > 3 && val.length < 256) {
        if (ENDPOINT_REGEX.test(val)) {
          endpoints.add(val);
        }
      }
    },
  });

  // Deduplicate findings by name
  const deduplicated = {};
  for (const [cat, list] of Object.entries(findings)) {
    const seen = new Set();
    deduplicated[cat] = [];
    for (const item of list) {
      if (!seen.has(item.name)) {
        seen.add(item.name);
        deduplicated[cat].push(item);
      }
    }
  }

  const summary = {
    hasCanvas: deduplicated.canvas.length > 0,
    hasWebGL: deduplicated.webgl.length > 0,
    hasAudio: deduplicated.audio.length > 0,
    hasAutomationCheck: deduplicated.automation.length > 0,
    hasHardwareProbe: deduplicated.hardware.length > 0,
    hasSensorProbe: deduplicated.sensors.length > 0,
    endpointCount: endpoints.size,
  };

  return {
    fingerprint: deduplicated,
    endpoints: Array.from(endpoints),
    summary,
  };
}

/**
 * Format a human-readable telemetry inspection report for terminal display.
 */
export function formatInspectionReport(result) {
  const lines = [];
  lines.push('=== Fingerprint & Telemetry Profile ===\n');

  const categories = [
    ['Canvas Fingerprinting', result.fingerprint.canvas],
    ['WebGL Vendor & Renderer', result.fingerprint.webgl],
    ['AudioContext Frequency', result.fingerprint.audio],
    ['Automation & Bot Tripwires', result.fingerprint.automation],
    ['Hardware & Display Probes', result.fingerprint.hardware],
    ['Device & Network Sensors', result.fingerprint.sensors],
  ];

  for (const [title, items] of categories) {
    if (items.length > 0) {
      const names = items.map((i) => i.name).join(', ');
      lines.push(`  [x] ${title.padEnd(28)} (${names})`);
    } else {
      lines.push(`  [ ] ${title.padEnd(28)} (not detected)`);
    }
  }

  lines.push('\n=== Discovered Endpoints & Paths ===\n');
  if (result.endpoints.length > 0) {
    for (const ep of result.endpoints) {
      lines.push(`  -> ${ep}`);
    }
  } else {
    lines.push('  (no distinct endpoints identified)');
  }

  return lines.join('\n');
}
