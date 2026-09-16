function writeString(buffer, offset, value) {
  for (let index = 0; index < value.length; index += 1) buffer.writeUInt8(value.charCodeAt(index), offset + index);
}

export function synthesizeDemoWav(text = 'Hello from AI Workbench') {
  const sampleRate = 8000;
  const seconds = Math.min(4, Math.max(0.6, String(text).length / 28));
  const samples = Math.floor(sampleRate * seconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  writeString(buffer, 0, 'RIFF');
  buffer.writeUInt32LE(36 + dataSize, 4);
  writeString(buffer, 8, 'WAVE');
  writeString(buffer, 12, 'fmt ');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  writeString(buffer, 36, 'data');
  buffer.writeUInt32LE(dataSize, 40);

  const frequency = 180 + (String(text).length % 12) * 18;
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.min(1, index / 800) * Math.min(1, (samples - index) / 800);
    const wave = Math.sin((2 * Math.PI * frequency * index) / sampleRate);
    buffer.writeInt16LE(Math.round(wave * envelope * 5000), 44 + index * 2);
  }
  return `data:audio/wav;base64,${buffer.toString('base64')}`;
}
