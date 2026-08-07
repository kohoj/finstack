import { isProvider, listKeys, PROVIDERS, removeKey, setKey } from '../data/keys';
import { FinstackError } from '../errors';

export async function keys(args: string[]) {
  const sub = args[0];

  switch (sub) {
    case 'set': {
      const provider = args[1];
      const key = args[2];
      if (!provider || !key) {
        throw new FinstackError(
          'Usage: finstack keys set <provider> <key>',
          undefined,
          'Both a provider and a key are required',
          `Providers: ${PROVIDERS.join(', ')}. Example: finstack keys set fred YOUR_KEY`,
        );
      }
      if (!isProvider(provider)) {
        throw new FinstackError(
          `Unknown provider: ${provider}`,
          undefined,
          `Supported providers are ${PROVIDERS.join(', ')}`,
          `Example: finstack keys set fred YOUR_KEY`,
        );
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
        throw new FinstackError(
          'Usage: finstack keys remove <provider>',
          undefined,
          'No provider given',
          'Run `finstack keys list` to see configured providers',
        );
      }
      removeKey(provider);
      console.log(JSON.stringify({ message: `Key removed for ${provider}` }));
      break;
    }

    default:
      throw new FinstackError(
        sub ? `Unknown subcommand: ${sub}` : 'Usage: finstack keys set|list|remove',
        undefined,
        undefined,
        'Use set|list|remove',
      );
  }
}
