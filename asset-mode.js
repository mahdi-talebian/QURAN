/*
 * Asset mode for Mushaf Touch.
 *
 * "auto"   = prefer local assets when they exist; otherwise use the development fallback.
 * "remote" = always load SVG and QCF4 JSON from the original GitHub repositories.
 * "local"  = require cloned project assets from ./assets (no upstream fallback).
 *
 * The production build changes this value to "local" automatically.
 */
window.MUSHAF_ASSET_MODE = "auto";
