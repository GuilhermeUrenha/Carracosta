const proxyList = new Map();

// const queueMap = createMapProxy('queueMap');
// const messageMap = createMapProxy('messageMap');

module.exports = function createMapProxy(proxy_map) {
  const map = !proxyList.has(proxy_map) ? proxyList.set(proxy_map, new Map()).get(proxy_map) : proxyList.get(proxy_map);

  const isProxy = (obj) => {
    return typeof Proxy === 'function' && Proxy.revocable && obj && obj[Symbol.toStringTag] === 'Proxy';
  };

  return new Proxy(map, {
    get(target, prop, receiver) {
      switch (prop) {
        case 'get':
          return (key) => {
            return Map.prototype.get.call(target, key);
          };

        case 'set':
          return (key, value) => {
            const proxy_value = typeof value === 'object' && value !== null && !isProxy(value)
              ? new Proxy(value, {
                set(target, prop, value) {
                  console.log(`${key} | ${proxy_map}.${prop}: ${target[prop]} to ${value}`);
                  target[prop] = value;

                  if (typeof value === 'object' && value !== null && !isProxy(value)) {
                    target[prop] = new Proxy(value, {
                      set(child_target, child_prop, child_value) {
                        console.log(`${mapName}.${prop}.${child_prop}: ${child_target[child_prop]} to ${child_value}`);
                        child_target[child_prop] = child_value;
                        return true;
                      }
                    });
                  } else if (Array.isArray(value) && !isProxy(value)) {
                    innerTarget[innerProp] = new Proxy(value, {
                      set(target, prop, value) {
                        console.log(`${key} | ${mapName}[${prop}]: ${target[prop]} to ${value}`);
                        target[prop] = value;
                        return true;
                      },
                    });
                  }
                  return true;
                }
              }) : value;

            console.log(`\nSet: "${key}" => "${value}"`);
            return Map.prototype.set.call(target, key, proxy_value);
          };

        case 'delete':
          return (key) => {
            console.log(`\nDelete: "${key}"`);
            return Map.prototype.delete.call(target, key);
          };

        case 'clear':
          return () => {
            return Map.prototype.clear.call(target);
          };

        case 'has':
          return (key) => {
            return Map.prototype.has.call(target, key);
          };

        default:
          return Reflect.get(target, prop, receiver);
      }
    }
  });
}