// A simple generator function to provide temporary IDs for generated resources.
function* simpleGenerator() {
  let n = 1;
  while (true)
    yield n++;
}


const simpleCounter = simpleGenerator();

let currentId = 0;
export function getCurrentId (){
  return currentId;
}

export function getIncrementalId() {
    currentId = simpleCounter.next().value.toString()
  return currentId;
}

// Removes null elements from an object.
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

// For parsing patient names.
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
 * Formats the errors output by the validator.validate() function
 * @param {String[]} errorOutput - The incoming error message array
 * @returns {String} - The formatted error message
 */
 export function formatErrorMessage(errorOutput) {
  let message = '\n\n';
  for (let i = 0; i < errorOutput.length; i++) {
    message += JSON.stringify(errorOutput[i], null, 4) + '\n';
  }
  message += '\n';
  return message;
}

/**
 * @param {object (FHIR Library)} library - FHIR Library to search in
 * @param {boolean} isNodeJs - True if running in Node.JS
 * @returns {object | undefined} - Parsed ELM JSON, if it exists
 */
 export function getElmJsonFromLibrary(library, isNodeJs=true) {
  for (const libraryContent of library.content) {
    if (libraryContent.contentType == "application/elm+json") {
      if (isNodeJs) {
        return JSON.parse(Buffer.from(libraryContent.data,'base64').toString('ascii'));
      }
      else {
        return JSON.parse(window.atob(libraryContent.data)); // TODO: Throw error on no data
      }
    }
  }
}
