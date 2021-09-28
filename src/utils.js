function* simpleGenerator() {
  let n = -1;
  while (true)
    yield n++;
}

let simpleCounter = simpleGenerator();

export function getIncrementalId() {
  return simpleCounter.next().value.toString();
}

export function pruneNull(obj) {
  if (Array.isArray(obj)) {
    return obj.filter(item => item != null).map(pruneNull);
  } else if (typeof obj == 'object') {
    return Object.keys(obj).reduce((acc,key) => {
      const val = pruneNull(obj[key]);
      if (val != null) acc[key] = val;
      return acc;
    }, {});
  }
  return obj;
}

export function elmJsonId(elmJson) {
  const id = elmJson?.library?.identifier?.id;
  const version = elmJson?.library?.identifier?.version;
  return version ? id + '|' + version : id;
}