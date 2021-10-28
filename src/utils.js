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

/**
 * In some cases we need to serialize objects coming out of CQL expressions. This 
 * occurs when the target element is a string but what is being returned by a CQL 
 * expression is an object (tuple or list). This function determines whether the 
 * value returned from CQL should be stringified or not.
 * @param {string} elementPath - The path to an element on a FHIR resource. 
 * @returns {boolean} - Whether the type of said element is a string.
 */
export function shouldTryToStringify(elementPath) {
  // NOTE: We *could* try to use the ModelInfo object provided by the cql-exec-fhir 
  // library to determine if the element specified by elementPath is supposed to 
  // be a string. The advantage of this approach is that it opens the door to more 
  // general kinds of type checking. But it is also complicated and doesn't cover 
  // the case where elementPath points to a choice element which could be but is 
  // not necessarily a string.
  //
  // Instead, we will assume that the type has been specified using the 
  // [ofType() function](https://hl7.org/fhirpath/#oftypetype-type-specifier-collection).
  // This is [explicitly allowed for choice elements](https://hl7.org/fhirpath/#paths-and-polymorphic-items) 
  // and is valid for non choice elements as well. Plus, ofType() is part of the 
  // [simple FHIRPath](https://www.hl7.org/fhir/fhirpath.html#simple) allowed in 
  // path.
  if (elementPath) {
    if (/ofType\(string\)$/.test(elementPath)) return true;
    else return false;
  } else {
    return false;
  }
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
    } else if (/ofType\(string\)$/.test(cv)) {
      return { // NOTE: Skip this part of the path if it is just a type specifier.
        open: acc.open,
        close: acc.close
      };
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