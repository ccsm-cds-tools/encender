import { simpleResolver } from "./simpleResolver.js";

/**
 * 
 * @param {Object} requestGroup 
 * @param {Object[]} otherResources 
 * @returns {Object} 
 */
export function merge(requestGroup, otherResources) {
  const resolver = simpleResolver(otherResources);
  if (requestGroup.action) {
    let merged = mergeActions(requestGroup.action, resolver);
    requestGroup.action = [
      ...merged
    ];
  }
  return requestGroup;
}

function mergeActions(actionArray, resolver) {
  return actionArray.map(action => {
    if (action.resource) {
      const resource = resolver(action.resource.reference)[0];
      if (resource?.resourceType === 'CarePlan') {
        const activities = resource.activity ?? [];
        return activities.reduce((acc,cv) => {
          if (cv?.reference?.reference) {
            const subResource = resolver(cv.reference.reference)[0];
            if (subResource?.resourceType === 'RequestGroup') {
              let temp = mergeActions(subResource.action ?? [], resolver);
              return [
                ...acc,
                ...temp
              ];
            } else {
              return acc;
            }
          } else {
            return acc;
          }
        },[]).flat();
      } else {
        return action;
      }
    } else {
      return action;
    }
  }).flat();
}