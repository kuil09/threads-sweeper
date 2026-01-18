// Icon Generator Script
// Run with Node.js to generate PNG icons from SVG

const fs = require('fs');
const path = require('path');

// SVG icon template - a broom/sweeper icon
const svgTemplate = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <!-- Background circle -->
  <circle cx="64" cy="64" r="60" fill="url(#grad1)"/>
  <!-- Broom emoji style -->
  <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-size="64">🧹</text>
</svg>
`;

// Simple placeholder icons (base64 encoded minimal PNGs)
// These are very small colored squares as placeholders
const createPlaceholderPNG = (size, color = '#667eea') => {
  // For a real implementation, you'd use canvas or a library like sharp
  // This creates a simple HTML file that can be screenshotted
  console.log(`Creating placeholder for ${size}x${size} icon`);
};

// Create icons directory if it doesn't exist
const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Generate SVG files (can be converted to PNG later)
const sizes = [16, 48, 128];

sizes.forEach(size => {
  const svgPath = path.join(iconsDir, `icon${size}.svg`);
  fs.writeFileSync(svgPath, svgTemplate(size).trim());
  console.log(`Generated: ${svgPath}`);
});

console.log('\nSVG icons generated!');
console.log('To convert to PNG, you can use:');
console.log('- Online converter: https://convertio.co/svg-png/');
console.log('- ImageMagick: convert icon.svg icon.png');
console.log('- Inkscape: inkscape icon.svg --export-png=icon.png');
