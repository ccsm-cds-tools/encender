const fhir_json_schema_validator = await import('@asymmetrik/fhir-json-schema-validator');
const JSONSchemaValidator = fhir_json_schema_validator.default;
const validator = new JSONSchemaValidator();

const isNodeJs = typeof process !== "undefined" && 
  process.versions != null && 
  process.versions.node != null;

const workerScript = isNodeJs ?
  ( await import('module') ).Module.createRequire(import.meta.url).resolve('cql-worker/src/cql-worker-thread.js') :
  './cql.worker.js';

const Worker = isNodeJs ? 
  ( await import('worker_threads') ).Worker : 
  window.Worker;

import { initialzieCqlWorker } from 'cql-worker';
import { 
  getIncrementalId, 
  pruneNull, 
  parseName, 
  expandPathAndValue, 
  shouldTryToStringify, 
  transformChoicePaths, 
  getElmJsonFromLibrary 
} from './utils.js';

export { simpleResolver } from './simpleResolver.js';

/**
 * Apply a PlanDefinition to a Patient
 * @param {Object} planDefinition - The PlanDefinition
 * @param {String} patientReference - A reference to the Patient
 * @param {Function} resolver - For resolving references to FHIR resources
 * @param {Object} aux - Auxiliary resources and services
 * @returns {Object[]} Array of resources: CarePlan, RequestGroup, and otherResources
 */
export async function applyPlan(planDefinition, patientReference=null, resolver=null, aux={}) {
  /*---------------------------------------------------------------------------- 
    [Applying a PlanDefinition](https://www.hl7.org/fhir/plandefinition.html#12.18.3.3)
    1. Create a CarePlan resource focused on the Patient in context and linked to the PlanDefinition using the instantiates element
    2. Create goal elements in the CarePlan based on the goal definitions in the plan
    3. Create a RequestGroup resource focused on the Patient in context and linked to the PlanDefinition using the instantiatesCanonical element
    4. Create an activity in the CarePlan to reference the RequestGroup
    5. Process each action element of the PlanDefinition
  ----------------------------------------------------------------------------*/

  // Validates the input parameters and returns the Patient resource if there are no issues
  const Patient = await applyGuard(planDefinition, patientReference, resolver, aux);

  // Either use the provided ID generation function or just use a simple counter.
  const getId = aux?.getId ?? getIncrementalId;

  /*----------------------------------------------------------------------------
  1. Create a CarePlan resource focused on the Patient in context and linked to 
  the PlanDefinition using the instantiates element
  ----------------------------------------------------------------------------*/
  let CarePlan = {
    resourceType: 'CarePlan',
    id: getId(),
    subject: {
      reference: 'Patient/' + Patient.id,
      display: parseName(Patient?.name)
    },
    instantiatesCanonical: planDefinition.url,
    intent: 'proposal',
    status: planDefinition?.status ?? 'draft'
  };

  /*----------------------------------------------------------------------------
  2. Create goal elements in the CarePlan based on the goal definitions in the 
  plan
  ----------------------------------------------------------------------------*/
  // TODO: Create Goal resources and reference them in the CarePlan.goal element

  /*----------------------------------------------------------------------------
  3. Create a RequestGroup resource focused on the Patient in context and linked 
  to the PlanDefinition using the instantiatesCanonical element
  ----------------------------------------------------------------------------*/
  let RequestGroup = {
    ...CarePlan,
    resourceType: 'RequestGroup',
    id: getId()
  };

  /*----------------------------------------------------------------------------
  4. Create an activity in the CarePlan to reference the RequestGroup
  ----------------------------------------------------------------------------*/
  CarePlan.activity = [
    {
      reference: { reference: 'RequestGroup/' + RequestGroup.id }
    }
  ];

  /*----------------------------------------------------------------------------
  5. Process each action element of the PlanDefinition
  ----------------------------------------------------------------------------*/
  let processedActions = []; // Array to hold processed actions
  let otherResources = []; // Any resources created as part of action processing

  // Setup the CQL Worker and process the actions
  let cqlWorker = new Worker(workerScript);
  try {

    let [setupExecution, sendPatientBundle, evaluateExpression] = initialzieCqlWorker(cqlWorker, isNodeJs);

    // Before processing each action, we need to check whether a library is being 
    // referenced by this PlanDefinition.
    if (Array.isArray(planDefinition.library)) {
      const libRef = planDefinition.library[0];

      // Check aux for objects necessary for CQL execution
      let elmJsonDependencies = aux.elmJsonDependencies ?? [];
      const valueSetJson = aux.valueSetJson ?? {};
      const cqlParameters = aux.cqlParameters ?? {};

      const elmJsonKey = Object.keys(elmJsonDependencies).filter(e => libRef.includes(e))[0];
      let elmJson = elmJsonDependencies[elmJsonKey];

      if (!elmJson) {
        const resolvedLibraries = await resolver(libRef);
        if (Array.isArray(resolvedLibraries) && resolvedLibraries.length > 0) {
          const library = resolvedLibraries[0]; // TODO: What to do if multiple libraries are found?
          // Find an ELM JSON Attachment
          // NOTE: The cql-worker library can only execute ELM JSON
          elmJson = getElmJsonFromLibrary(library, isNodeJs);
          if (!elmJson) {
            throw new Error('No Attachments with contentType "application/elm+json" found in referenced Library: ' + libRef);
          }
        } else {
          throw new Error('Cannot resolve referenced Library: ' + libRef);
        }
      }
      
      setupExecution(elmJson, valueSetJson, cqlParameters, elmJsonDependencies);
      // Define patient bundle
      var patientBundle = {
        resourceType: 'Bundle',
        id: 'survey-bundle',
        type: 'collection',
        entry: ( await resolver() ).map(r => {return {resource: r}})
      };
      sendPatientBundle(patientBundle);
    }

    // If there are actions defined in this PlanDefinition, process them asynchronously
    if (planDefinition?.action) {
      ({processedActions, otherResources} = await processActions(planDefinition.action, patientReference, resolver, aux, evaluateExpression));
      RequestGroup.action = processedActions;
    }
  } finally {
    cqlWorker?.terminate();
  }
  
  return [
    CarePlan,
    RequestGroup,
    ...otherResources
  ];

}

/**
 * Validates the input parameters to both apply functions.
 * @param {Object} appliableResource - The FHIR Resource to be applied
 * @param {String} patientReference - A reference to the Patient
 * @param {Function} resolver - For resolving references to FHIR resources
 * @param {Object} aux - Auxiliary resources and services
 * @returns {Object[]} The resolved Patient resource
 */
async function applyGuard(appliableResource, patientReference=null, resolver=null, aux={}) {

  // Validate inputs
  const appliableResourceTypes = [
    'PlanDefinition',
    'ActivityDefinition'
  ];
  if (appliableResourceTypes.includes(appliableResource?.resourceType) == false) {
    let errMsg = 'One of the following resources must be provided';
    appliableResourceTypes.forEach((rtp,ind) => {
      if (ind==0) errMsg = errMsg + ': ' + rtp;
      else errMsg = errMsg + ', ' + rtp;
    });
    throw new Error(errMsg);
  } else if (!patientReference || typeof patientReference != 'string') {
    throw new Error('A Patient reference string must be provided')
  } else if (!resolver || typeof resolver != 'function') {
    throw new Error('A resource resolver function must be provided')
  } else if (aux?.validateIncoming) {
    try {
      // NOTE: Validation is a very costly operation to perform.
      let errors = validator.validate(appliableResource);
      if (errors.length > 0) {
        throw(errors);
      }
    } catch(err) {
      const newErr = 'Input is not a valid FHIR resource\nErrors from FHIR JSON Schema Validator: ' + formatErrorMessage(err);
      throw new Error(newErr);
    }
  } else if (('url' in appliableResource) == false) {
    throw new Error('Incoming Definition does not have a canonical URL');
  }

  // Try to resolve the patient reference
  let Patient = await resolver(patientReference);
  if (!Patient || Patient?.length == 0 || !Patient[0]) throw new Error('Patient reference cannot be resolved');
  Patient = Patient[0];

  return Patient;

}

/**
 * Process the actions of a PlanDefinition
 * @param {Object[]} actions - An array of actions
 * @param {String} patientReference - A reference to the Patient
 * @param {Function} resolver - For resolving references to FHIR resources
 * @param {Object} aux - Auxiliary resources and services
 * @returns {Object} Contains the applied actions as well as any generated resources
 */
async function processActions(actions, patientReference, resolver, aux, evaluateExpression) {
  /*----------------------------------------------------------------------------
    [Applying a PlanDefinition](https://www.hl7.org/fhir/plandefinition.html#12.18.3.3)
    Processing for each action proceeds according to the following steps:
    5.1. Determine applicability by evaluating the applicability conditions defined for the element
    5.2. If the action is applicable, determine whether the action is a group or a single, atomic activity (does the action have child actions?)
    5.3. If the action is atomic, process according to the following steps:
      - Create an action element in the RequestGroup with the same id as the action being processed
      - Apply the elements of the action to the corresponding elements of the newly created action in the RequestGroup such as title, description, textEquivalent, timing, and so on
      - Carry any start and stop conditions defined in the plan action forward to the request group action.
      - There are three possibilities for the definition element:
        - ActivityDefinition:
          1. Create the target resource as described in the Applying an ActivityDefinition topic
          2. Reference the resulting resource in the resource element of the action. Note that the target resource can be set as a contained resource in the RequestGroup, or it can be persisted independently, as appropriate for the environment
          3. Set the status of the target resource to option so that it is clearly indicated as part of a RequestGroup. Note that the ActivityDefinition/$apply operation will not necessarily produce resource with this status, so this is an important step.
          4. Apply any overrides based on the elements of the action (see the section on Overlap below for details)
        - PlanDefinition:
          1. Create a CarePlan by applying the target PlanDefinition
          2. Reference the resulting resource in the resource element of the action. Note that the resulting CarePlan can be set as a contained resource in the RequestGroup, but doing so would require expanding any potentially contained resources.
          3. Set the status of the CarePlan to option so that it is clearly indicated as part of a RequestGroup.
          4. Apply any overrides based on the elements of the action such as title, description, and dynamicValue.
        - Questionnaire: Set the resource element of the action to the Questionnaire, indicating that the activity to be performed is filling out the given questionnaire.
    5.4. If the action is a group, determine which actions to process based on the behaviors specified in the group. Note that this aspect of the process may require input from a user. In these cases, either the choices made by the user can be provided as input to the process, or the process can be performed as part of a user-entry workflow that enables user input to be provided as necessary.
  ----------------------------------------------------------------------------*/

  // Either use the provided ID generation function or just use a simple counter.
  const getId = aux?.getId ?? getIncrementalId;

  // These are our two main outputs
  let processedActions = [];
  let otherResources = []; // Any resources created as part of action processing

  // Loop over the actions
  await Promise.all(actions.map(async (act) => {

    // Copy over basic elements from the action definitions
    // NOTE: This technically falls under 5.3, but should be done for both group and atomic actions
    let applied = pruneNull({
      id: act?.id ?? getId(),
      title: act?.title,
      description: act?.description,
      textEquivalent: act?.textEquivalent
      // TODO: Copy of over timing and any other elements that make sense
      // TODO: Carry over start and stop conditions
    });

    // 5.1. Evaluate applicability conditions
    let applyThisCondition = true;
    if (act?.condition) {
      // TODO: Check that these are applicability conditions
      const evaluatedConditions = await Promise.all(act.condition.map(async (c) => {
        if (c?.expression?.language != 'text/cql') {
          throw new Error('Action condition specifies an unsupported expression language');
        }
        const expression = c.expression.expression;
        const value = await evaluateExpression(expression);
        return value;
        // TODO: Throw error if expression can't be evaluated (two cases)
      }));

      // NOTE: Multiple conditions are ANDed together
      // https://www.hl7.org/fhir/plandefinition-definitions.html#PlanDefinition.action.condition
      applyThisCondition = applyThisCondition && evaluatedConditions.reduce((acc,ec) => acc && ec, true);

    }

    if (applyThisCondition) {

      // 5.2. Determine if action is a group or atomic
      const def = act?.definitionCanonical;
      if (def) {
        // 5.3. If there is a definition we assume this action is atomic

        let evaluatedValues = [];
        if (act?.dynamicValue) {
          // Asynchronously evaluate all dynamicValues
          evaluatedValues = await Promise.all(act.dynamicValue.map(async (dV) => {
            if (dV?.expression?.language != 'text/cql') {
              throw new Error('Dynamic value specifies an unsupported expression language');
            }
            const value = await evaluateExpression(dV.expression.expression);
            return {
              path: dV.path,
              evaluated: value
            };
            // TODO: Throw error if expression can't be evaluated (two cases)
          }));
        }

        if (/PlanDefinition/.test(def)) {
          // If this is a PlanDefinition, resolve it so we can apply it
          const planDefinition = ( await resolver(def) )[0];
          // NOTE: Recursive function call
          let [CarePlan, RequestGroup, ...moreResources] = await applyPlan(planDefinition, patientReference, resolver, aux);

          // Link the generated CarePlan's id via the resource element
          applied.resource = {
            reference: 'CarePlan/' + CarePlan.id
          };

          // Set the status of the target resource to option
          CarePlan.status = 'option';
          
          // Apply any overrides based on the elements of the action such as title, description, and dynamicValue.
          // NOTE: Action takes precedence over PlanDefinition
          applied = pruneNull({
            ...applied,
            title: act?.title ?? planDefinition?.title,
            description: act?.description ?? planDefinition?.relatedArtifact,
            textEquivalent: act?.textEquivalent
          });

          if (act?.dynamicValue) {
            // Copy the values over to the target resource
            CarePlan = evaluatedValues.reduce((acc, cv) => {
              let path = transformChoicePaths('CarePlan', cv.path);
              let value = shouldTryToStringify(cv.path, cv.evaluated) ? JSON.stringify(cv.evaluated) : cv.evaluated;
              let append = expandPathAndValue(path, value);
              return {
                ...acc,
                ...append
              };
            }, CarePlan);
          }

          // Bubble up the resources which were generated by this apply operation
          otherResources.push(CarePlan);
          otherResources.push(RequestGroup);
          moreResources.forEach(mr => otherResources.push(mr));

        } else if (/ActivityDefinition/.test(def)) {
          // If this is an ActivityDefinition, resolve it so we can apply it
          const activityDefinition = ( await resolver(def) )[0];
          let targetResource = await applyActivity(activityDefinition, patientReference, resolver, aux);

          // Link the generated CarePlan's id via the resource element
          applied.resource = {
            reference: targetResource.resourceType + '/' + targetResource.id
          };

          // Set the status of the target resource to option
          targetResource.status = 'option';

          // Apply any overrides based on the elements of the action such as title, description, and dynamicValue.
          // NOTE: [PlanDefinition takes precedence over ActivityDefinition](https://www.hl7.org/fhir/plandefinition.html#12.18.3.4)
          applied = pruneNull({
            ...applied,
            title: act?.title ?? activityDefinition?.title,
            description: act?.description ?? activityDefinition?.relatedArtifact,
            textEquivalent: act?.textEquivalent
          });

          if (act?.dynamicValue) {
            // Copy the values over to the target resource
            targetResource = evaluatedValues.reduce((acc, cv) => {
              let path = transformChoicePaths(targetResource.resourceType, cv.path);
              let value = shouldTryToStringify(cv.path, cv.evaluated) ? JSON.stringify(cv.evaluated) : cv.evaluated;
              let append = expandPathAndValue(path, value);
              return {
                ...acc,
                ...append
              };
            }, targetResource);
          }

          // Bubble up the resources which were generated by this apply operation
          otherResources.push(targetResource);

        } else if (/Questionnaire/.test(def)) {
          // TODO: Process Questionnaires

        }

      } else if (act?.action) {
        // 5.4. If there are sub-actions then we assume this is a group

        // NOTE: Recursive function call
        const {processedActions: subActions, otherResources: moreResources} = await
          processActions(act.action, patientReference, resolver, aux, evaluateExpression);

        // Bubble up the sub-actions and any resources which were created by processing them
        applied.action = subActions;
        moreResources.forEach(mr => otherResources.push(mr));

      } else {
        // Don't have a definition and don't have sub-actions
        // TODO: Determine if there is anything we need to do for this case
      }

      // Add the applied action to the processed array
      processedActions.push(applied);

    }
  }));

  return {
    processedActions: processedActions,
    otherResources: otherResources // Any resources created as part of action processing
  };
}

/**
 * Formats the errors output by the validator.validate() function
 * @param {String[]} errorOutput - The incoming error message array
 * @returns {String} - The formatted error message
 */
function formatErrorMessage(errorOutput) {
  let message = '\n\n';
  for (let i = 0; i < errorOutput.length; i++) {
    message += JSON.stringify(errorOutput[i], null, 4) + '\n';
  }
  message += '\n';
  return message;
}

/**
 * Apply an ActivityDefinition to a Patient
 * @param {Object} planDefinition - The ActivityDefinition
 * @param {String} patientReference - A reference to the Patient
 * @param {Function} resolver - For resolving references to FHIR resources
 * @param {Object} aux - Auxiliary resources and services
 * @returns {Object} The requested resource
 */
 export async function applyActivity(activityDefinition, patientReference=null, resolver=null, aux={}) {
  /*---------------------------------------------------------------------------- 
    [Applying an ActivityDefinition](https://www.hl7.org/fhir/activitydefinition.html#12.17.3.3)
    1. Create the target resource of the type specified by the kind element and focused on the Patient in context
    2. Set the status of the target resource to draft
    3. Apply the structural elements of the ActivityDefinition to the target resource such as code, timing, doNotPerform, product, quantity, dosage, and so on
    4. Resolve the participant element based on the user in context
    5. Resolve the location element based on the location in context
    6. If the transform element is specified, apply the transform to the resource. Note that the referenced StructureMap may actually construct the resource, rather than taking an instance. See the StructureMap for more information
    7. Apply any dynamicValue elements (in the order in which they appear in the ActivityDefinition resource) by evaluating the expression and setting the value of the appropriate element of the target resource (as specified by the dynamicValue.path element)
  ----------------------------------------------------------------------------*/

  // Validates the input parameters and returns the Patient resource if there are no issues
  const Patient = await applyGuard(activityDefinition, patientReference, resolver, aux);

  // Either use the provided ID generation function or just use a simple counter.
  const getId = aux?.getId ?? getIncrementalId;

  /*----------------------------------------------------------------------------
    1. Create the target resource of the type specified by the kind element and focused on the Patient in context
  ----------------------------------------------------------------------------*/
  let targetResource = {
    id: getId(),
    subject: {
      reference: 'Patient/' + Patient.id,
      display: parseName(Patient?.name)
    }
  };
  
  // https://www.hl7.org/fhir/valueset-request-resource-types.html
  const requestResourceTypes = [
    'Appointment',
    'AppointmentResponse',
    'CarePlan',
    'Claim',
    'CommunicationRequest',
    'Contract',
    'DeviceRequest',
    'EnrollmentRequest',
    'ImmunizationRecommendation',
    'MedicationRequest',
    'NutritionOrder',
    'ServiceRequest',
    'SupplyRequest',
    'Task',
    'VisionPrescription'
  ];
  if (requestResourceTypes.includes(activityDefinition?.kind)) {
    targetResource.resourceType = activityDefinition.kind;
  } else {
    let errMsg = 'ActivityDefinition.kind must be one of the following resources';
    requestResourceTypes.forEach((rtp,ind) => {
      if (ind==0) errMsg = errMsg + ': ' + rtp;
      else errMsg = errMsg + ', ' + rtp;
    });
    throw new Error(errMsg);
  }

  /*----------------------------------------------------------------------------
    2. Set the status of the target resource to draft
  ----------------------------------------------------------------------------*/
  targetResource.status = 'draft';

  /*----------------------------------------------------------------------------
    3. Apply the structural elements of the ActivityDefinition to the target resource such as code, timing, doNotPerform, product, quantity, dosage, and so on
  ----------------------------------------------------------------------------*/
  targetResource = pruneNull({
    ...targetResource,
    code: activityDefinition?.code,
    timing: activityDefinition?.timing,
    doNotPerform: activityDefinition?.doNotPerform,
    product: activityDefinition?.product,
    quantity: activityDefinition?.quantity,
    dosage: activityDefinition?.dosage
    // TODO: Copy over other structural elements as it makes sense
  });

  /*----------------------------------------------------------------------------
    4. Resolve the participant element based on the user in context
  ----------------------------------------------------------------------------*/
  // TODO

  /*----------------------------------------------------------------------------
    5. Resolve the location element based on the location in context
  ----------------------------------------------------------------------------*/
  // TODO

  /*----------------------------------------------------------------------------
    6. If the transform element is specified, apply the transform to the resource
  ----------------------------------------------------------------------------*/
  // TODO

  /*----------------------------------------------------------------------------
    7. Apply any dynamicValue elements
  ----------------------------------------------------------------------------*/
  if (activityDefinition?.dynamicValue) {
    // Define a new worker thread to evaluate these dynamicValue expressions
    let cqlWorker = new Worker(workerScript);
    try {
      let [setupExecution, sendPatientBundle, evaluateExpression] = initialzieCqlWorker(cqlWorker, isNodeJs);
      if (Array.isArray(activityDefinition.library)) {
        const libRef = activityDefinition.library[0];
  
        // Check aux for objects necessary for CQL execution
        let elmJsonDependencies = aux.elmJsonDependencies ?? [];
        const valueSetJson = aux.valueSetJson ?? {};
        const cqlParameters = aux.cqlParameters ?? {};
  
        const elmJsonKey = Object.keys(elmJsonDependencies).filter(e => libRef.includes(e))[0];
        let elmJson = elmJsonDependencies[elmJsonKey];
  
        if (!elmJson) {
          const resolvedLibraries = await resolver(libRef);
          if (Array.isArray(resolvedLibraries) && resolvedLibraries.length > 0) {
            const library = resolvedLibraries[0]; // TODO: What to do if multiple libraries are found?
            // Find an ELM JSON Attachment
            // NOTE: The cql-worker library can only execute ELM JSON
            elmJson = getElmJsonFromLibrary(library, inNode);
            if (!elmJson) {
              throw new Error('No Attachments with contentType "application/elm+json" found in referenced Library: ' + libRef);
            }
          } else {
            throw new Error('Cannot resolve referenced Library: ' + libRef);
          }
        }
        setupExecution(elmJson, valueSetJson, cqlParameters, elmJsonDependencies);
        // Define patient bundle
        var patientBundle = {
          resourceType: 'Bundle',
          id: 'survey-bundle',
          type: 'collection',
          entry: ( await resolver() ).map(r => {return {resource: r}})
        };
        sendPatientBundle(patientBundle);
      } else {
        // TODO: Throw error because we have a dynamic value but no library defined
      }

      // Asynchronously evaluate all dynamicValues
      const evaluatedValues = await Promise.all(activityDefinition.dynamicValue.map(async (dV) => {
        if (dV?.expression?.language != 'text/cql') {
          throw new Error('Dynamic value specifies an unsupported expression language');
        }
        const value = await evaluateExpression(dV.expression.expression);
        return {
          path: dV.path,
          evaluated: value
        };
        // TODO: Throw error if expression can't be evaluated (two cases)
      }));

      // Copy the values over to the target resource
      targetResource = evaluatedValues.reduce((acc, cv) => {
        let path = transformChoicePaths(targetResource.resourceType, cv.path);
        let value = shouldTryToStringify(cv.path, cv.evaluated) ? JSON.stringify(cv.evaluated) : cv.evaluated;
        let append = expandPathAndValue(path, value);
        return {
          ...acc,
          ...append
        };
      }, targetResource);
    } finally {
      cqlWorker?.terminate();
    }
  }

  return targetResource;

}