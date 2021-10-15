function* simpleGenerator() {
  let n = 1;
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

export function parseName(names) {
  let name = '';
  if (Array.isArray(names)) {
    name = names.reduce((acc, cv) => {
      if (acc == '') {
        if (cv.text) return cv.text;
        else if (cv.family) {
          if (cv.given && Array.isArray(cv.given)) {
            return cv.given.reduce((a,c) => a + ' ' + c,'') + ' ' + cv.family;
          } else return cv.family;
        }
        else return acc;
      } else return acc;
    }, name);
  } // TODO: Else throw error
  return name.trim();
}

export function expandPathAndValue(path, value) {
  // Split the path string along the dots ('.') and construct the opening and 
  // closing brackets.
  let jsonStringComponents = path.split('.').reduce((acc, cv) => {
    // NOTE: If we see an opening square bracket ('['), assume this is an array 
    // with a single element.
    if (/\[/.test(cv)) {
      let arrayParts = cv.split('[');
      let arrayName = arrayParts[0];
      return {
        open: acc.open + `{"${arrayName}":[`,
        close: ']}' + acc.close
      }
    } else {
      return {
        open: acc.open + `{"${cv}":`,
        close: '}' + acc.close
      }
    }
  }, {
    open: '',
    close: ''
  });

  // Sandwich the value in between the open and closing components.
  let jsonString = jsonStringComponents.open + 
    JSON.stringify(value) + 
    jsonStringComponents.close;

  // Parse the JSON string.
  let expandedObject = JSON.parse(jsonString);
  return expandedObject;
}