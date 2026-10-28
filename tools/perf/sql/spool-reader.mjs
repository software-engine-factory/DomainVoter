import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";

export async function* replaySpool(file, chunkSize) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let rows = [];
  for await (const bytes of fs.createReadStream(file, { highWaterMark: 65536 })) {
    pending += decoder.write(bytes);
    let split;
    while ((split = pending.indexOf("\n")) !== -1) {
      rows.push(JSON.parse(pending.slice(0, split)));
      pending = pending.slice(split + 1);
      if (rows.length === chunkSize) { yield rows; rows = []; }
    }
  }
  pending += decoder.end();
  if (pending.length) rows.push(JSON.parse(pending));
  if (rows.length) yield rows;
}
