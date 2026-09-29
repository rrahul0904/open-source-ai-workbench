import { compareDemo } from '../src/model-compare.mjs';

const prompt = process.argv.slice(2).join(' ').trim() || 'Compare approaches to a reliable data pipeline';
const result = await compareDemo({ prompt });
console.log(JSON.stringify(result, null, 2));
