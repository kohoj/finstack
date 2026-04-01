import { getKey, setKey, removeKey, listKeys } from '../data/keys';

export async function keys(args: string[]) {
  const sub = args[0];

  switch (sub) {
    case 'set': {
      const provider = args[1];
      const key = args[2];
      if (!provider || !key) {
        console.error(JSON.stringify({ error: 'Usage: finstack keys set <provider> <key>' }));
        process.exit(1);
      }
      setKey(provider, key);
      console.log(JSON.stringify({ message: `Key set for ${provider}` }));
      break;
    }

    case 'list': {
      const entries = listKeys();
      console.log(JSON.stringify({ keys: entries }, null, 2));
      break;
    }

    case 'remove': {
      const provider = args[1];
      if (!provider) {
        console.error(JSON.stringify({ error: 'Usage: finstack keys remove <provider>' }));
        process.exit(1);
      }
      removeKey(provider);
      console.log(JSON.stringify({ message: `Key removed for ${provider}` }));
      break;
    }

    default:
      console.error(JSON.stringify({ error: 'Usage: finstack keys set|list|remove' }));
      process.exit(1);
  }
}
