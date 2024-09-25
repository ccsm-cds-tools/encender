import { Worker as NodeWorker } from "worker_threads";
import { createRequire } from "module";
import { initialzieCqlWorker } from "cql-worker";

import {
  getIncrementalId,
  pruneNull,
  parseName,
  getElmJsonFromLibrary,
} from "./utils.js";
import { PatientSource } from "cql-exec-fhir";
import { validate } from "./validate.js";
import { merge } from "./merge.js";

import {
  expandPathAndValue,
  shouldTryToStringify,
  transformChoicePaths,
} from "./dynamic.js";

const executeCQL = async (
  libContainer = null,
  patientReference = null,
  resolver = null,
  aux = {}
) => {
  let isNodeJs = aux?.isNodeJs ?? false;
  const WorkerFactory =
    aux?.WorkerFactory ??
    (() => {
      isNodeJs = true;
      const require = createRequire(import.meta.url);
      return new NodeWorker(
        require.resolve("cql-worker/src/cql-worker-thread.js")
      );
    });
  let cqlWorker = WorkerFactory();
  try {
    let [
      setupExecution,
      sendPatientBundle,
      evaluateExpression,
      evaluateLibrary,
    ] = initialzieCqlWorker(cqlWorker, isNodeJs);

    let patientId = patientReference.replace("Patient/", "");
    if (Array.isArray(libContainer.library)) {
      const libRef = libContainer.library[0];
      const cqlExecutionCache = aux?.cqlExecutionCache || {};
      if (cqlExecutionCache[libRef]) {
        return cqlExecutionCache[libRef];
      }
      aux.cqlExecutionCache = cqlExecutionCache;
      let elmJsonDependencies = aux.elmJsonDependencies ?? [];
      const valueSetJson = aux.valueSetJson ?? {};
      const cqlParameters = aux.cqlParameters ?? {};

      const elmJsonKey = Object.keys(elmJsonDependencies).filter((e) =>
        libRef.includes(e)
      )[0];
      let elmJson = elmJsonDependencies[elmJsonKey];

      if (!elmJson) {
        const resolvedLibraries = await resolver(libRef);
        if (Array.isArray(resolvedLibraries) && resolvedLibraries.length > 0) {
          const library = resolvedLibraries[0]; // TODO: What to do if multiple libraries are found?
          // Find an ELM JSON Attachment
          // NOTE: The cql-worker library can only execute ELM JSON
          elmJson = getElmJsonFromLibrary(library, isNodeJs);
          if (!elmJson) {
            throw new Error(
              'No Attachments with contentType "application/elm+json" found in referenced Library: ' +
                libRef
            );
          }
        } else {
          throw new Error("Cannot resolve referenced Library: " + libRef);
        }
      }
      // let repository  = new cql.Repository({
      //     'FHIRHelpers': fhirHelpersJson,
      //     ...elmJsonDependencies
      //   });

      // let library = new cql.Library(elmJson, repository);
      // let codeService = new cql.CodeService(valueSetJson);
      // let executor = new cql.Executor(library, codeService, cqlParameters);

      await setupExecution(
        elmJson,
        valueSetJson,
        cqlParameters,
        elmJsonDependencies
      );

      let patientBundle = {
        resourceType: "Bundle",
        id: "survey-bundle",
        type: "collection",
        entry: (await resolver()).map((r) => {
          return { resource: r };
        }),
      };
      await sendPatientBundle(patientBundle);

      let psource = new PatientSource.FHIRv401();
      psource.loadBundles([patientBundle]);
      let results = await evaluateLibrary();
      cqlExecutionCache[libRef] = results;
      return results;
    }
  } catch (e) {
    throw e;
  } finally {
    cqlWorker?.terminate();
  }
};

export { simpleResolver } from "./simpleResolver.js";

export async function applyAndMerge(
  planDefinition,
  patientReference = null,
  resolver = null,
  aux = {}
) {
  let [CarePlan, RequestGroup, ...otherResources] = await applyPlan(
    planDefinition,
    patientReference,
    resolver,
    aux
  );

  RequestGroup = await merge(RequestGroup, otherResources);
  return [
    RequestGroup,
    ...otherResources.filter(
      (otr) =>
        otr?.resourceType &&
        ["CarePlan", "RequestGroup"].includes(otr.resourceType) === false
    ),
  ];
}

/**
 * Apply a PlanDefinition to a Patient
 * @param {Object} planDefinition - The PlanDefinition
 * @param {String} patientReference - A reference to the Patient
 * @param {Function} resolver - For resolving references to FHIR resources
 * @param {Object} aux - Auxiliary resources and services
 * @returns {Promise<Object[]>} Array of resources: CarePlan, RequestGroup, and otherResources
 */
export async function applyPlan(
  planDefinition,
  patientReference = null,
  resolver = null,
  aux = {}
) {
  /*---------------------------------------------------------------------------- 
    [Applying a PlanDefinition](https://www.hl7.org/fhir/plandefinition.html#12.18.3.3)
    1. Create a CarePlan resource focused on the Patient in context and linked to the PlanDefinition using the instantiates element
    2. Create goal elements in the CarePlan based on the goal definitions in the plan
    3. Create a RequestGroup resource focused on the Patient in context and linked to the PlanDefinition using the instantiatesCanonical element
    4. Create an activity in the CarePlan to reference the RequestGroup
    5. Process each action element of the PlanDefinition
  ----------------------------------------------------------------------------*/
  // Validates the input parameters and returns the Patient resource if there are no issues
  const Patient = await validate(
    planDefinition,
    patientReference,
    resolver,
    aux
  );

  // Either use the provided ID generation function or just use a simple counter.
  const getId = aux?.getId ?? getIncrementalId;

  /*----------------------------------------------------------------------------
  1. Create a CarePlan resource focused on the Patient in context and linked to 
  the PlanDefinition using the instantiates element
  ----------------------------------------------------------------------------*/
  let CarePlan = {
    resourceType: "CarePlan",
    id: getId(),
    subject: {
      reference: "Patient/" + Patient.id,
      display: parseName(Patient?.name),
    },
    instantiatesCanonical: planDefinition.url,
    intent: "proposal",
    status: planDefinition?.status ?? "draft",
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
    resourceType: "RequestGroup",
    id: getId(),
  };

  /*----------------------------------------------------------------------------
  4. Create an activity in the CarePlan to reference the RequestGroup
  ----------------------------------------------------------------------------*/
  CarePlan.activity = [
    {
      reference: { reference: "RequestGroup/" + RequestGroup.id },
    },
  ];

  /*----------------------------------------------------------------------------
  5. Process each action element of the PlanDefinition
  ----------------------------------------------------------------------------*/
  let processedActions = []; // Array to hold processed actions
  let otherResources = []; // Any resources created as part of action processing

  let patientResult =
    (await executeCQL(planDefinition, patientReference, resolver, aux)) || {};
  let evaluateExpression = (expression) => {
    return patientResult[expression];
  };
  // If there are actions defined in this PlanDefinition, process them asynchronously
  if (planDefinition?.action) {
    ({ processedActions, otherResources } = await processActions(
      planDefinition.action,
      patientReference,
      resolver,
      aux,
      evaluateExpression
    ));
    RequestGroup.action = processedActions;
  }

  return [CarePlan, RequestGroup, ...otherResources];
}

/**
 * Process the actions of a PlanDefinition
 * @param {Object[]} actions - An array of actions
 * @param {String} patientReference - A reference to the Patient
 * @param {Function} resolver - For resolving references to FHIR resources
 * @param {Object} aux - Auxiliary resources and services
 * @returns {Object} Contains the applied actions as well as any generated resources
 */
export async function processActions(
  actions,
  patientReference,
  resolver,
  aux,
  evaluateExpression
) {
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
  await Promise.all(
    actions.map(async (act) => {
      // Copy over basic elements from the action definitions
      // NOTE: This technically falls under 5.3, but should be done for both group and atomic actions
      let applied = pruneNull({
        id: act?.id ?? getId(),
        title: act?.title,
        description: act?.description,
        documentation: act?.documentation,
        textEquivalent: act?.textEquivalent,
        groupingBehavior: act?.groupingBehavior,
        selectionBehavior: act?.selectionBehavior,
        requiredBehavior: act?.requiredBehavior,
        precheckBehavior: act?.precheckBehavior,
        cardinalityBehavior: act?.cardinalityBehavior,
        // TODO: Copy of over timing and any other elements that make sense
        // TODO: Carry over start and stop conditions
      });

      // 5.1. Evaluate applicability conditions
      let applyThisCondition = true;
      if (act?.condition) {
        // TODO: Check that these are applicability conditions
        const evaluatedConditions = act.condition.map((c) => {
          if (c?.expression?.language != "text/cql") {
            throw new Error(
              "Action condition specifies an unsupported expression language"
            );
          }
          const expression = c.expression.expression;
          const value = evaluateExpression(expression);
          return value;
          // TODO: Throw error if expression can't be evaluated (two cases)
        });

        // NOTE: Multiple conditions are ANDed together
        // https://www.hl7.org/fhir/plandefinition-definitions.html#PlanDefinition.action.condition
        applyThisCondition =
          applyThisCondition &&
          evaluatedConditions.reduce((acc, ec) => acc && ec, true);
      }

      if (applyThisCondition) {
        // 5.2. Determine if action is a group or atomic
        const def = act?.definitionCanonical;
        if (def) {
          // 5.3. If there is a definition we assume this action is atomic

          let evaluatedValues = [];
          if (act?.dynamicValue) {
            // Asynchronously evaluate all dynamicValues
            evaluatedValues = act.dynamicValue.map((dV) => {
              if (dV?.expression?.language != "text/cql") {
                throw new Error(
                  "Dynamic value specifies an unsupported expression language"
                );
              }
              const value = evaluateExpression(dV.expression.expression);
              return {
                path: dV.path,
                evaluated: value,
              };
              // TODO: Throw error if expression can't be evaluated (two cases)
            });
          }

          if (/PlanDefinition/.test(def)) {
            // If this is a PlanDefinition, resolve it so we can apply it
            const planDefinition = (await resolver(def))[0];
            // NOTE: Recursive function call
            let [CarePlan, RequestGroup, ...moreResources] = await applyPlan(
              planDefinition,
              patientReference,
              resolver,
              aux
            );

            // Link the generated CarePlan's id via the resource element
            applied.resource = {
              reference: "CarePlan/" + CarePlan.id,
            };

            // Set the status of the target resource to option
            CarePlan.status = "option";

            // Apply any overrides based on the elements of the action such as title, description, and dynamicValue.
            // NOTE: Action takes precedence over PlanDefinition
            applied = pruneNull({
              ...applied,
              title: act?.title ?? planDefinition?.title,
              description: act?.description ?? planDefinition?.description,
              documentation:
                act?.documentation ?? planDefinition?.relatedArtifact,
            });

            if (act?.dynamicValue) {
              // Copy the values over to the target resourced
              CarePlan = evaluatedValues.reduce((acc, cv) => {
                let path = transformChoicePaths("CarePlan", cv.path);
                let value = shouldTryToStringify(cv.path, cv.evaluated)
                  ? JSON.stringify(cv.evaluated)
                  : cv.evaluated;
                let append = expandPathAndValue(path, value);
                return {
                  ...acc,
                  ...append,
                };
              }, CarePlan);
            }

            // Bubble up the resources which were generated by this apply operation
            otherResources.push(CarePlan);
            otherResources.push(RequestGroup);
            moreResources.forEach((mr) => otherResources.push(mr));
          } else if (/ActivityDefinition/.test(def)) {
            // If this is an ActivityDefinition, resolve it so we can apply it
            const activityDefinition = (await resolver(def))[0];
            let targetResource = await applyActivity(
              activityDefinition,
              patientReference,
              resolver,
              aux
            );

            // Link the generated CarePlan's id via the resource element
            applied.resource = {
              reference: targetResource.resourceType + "/" + targetResource.id,
            };

            // Set the status of the target resource to option
            targetResource.status = "option";

            // Apply any overrides based on the elements of the action such as title, description, and dynamicValue.
            // NOTE: [PlanDefinition takes precedence over ActivityDefinition](https://www.hl7.org/fhir/plandefinition.html#12.18.3.4)
            applied = pruneNull({
              ...applied,
              title: act?.title ?? activityDefinition?.title,
              description: act?.description ?? activityDefinition?.description,
              documentation:
                act?.documentation ?? activityDefinition?.relatedArtifact,
            });

            if (act?.dynamicValue) {
              // Copy the values over to the target resource
              targetResource = evaluatedValues.reduce((acc, cv) => {
                let path = transformChoicePaths(
                  targetResource.resourceType,
                  cv.path
                );
                let value = shouldTryToStringify(cv.path, cv.evaluated)
                  ? JSON.stringify(cv.evaluated)
                  : cv.evaluated;
                let append = expandPathAndValue(path, value);
                return {
                  ...acc,
                  ...append,
                };
              }, targetResource);
            }

            // Bubble up the resources which were generated by this apply operation
            otherResources.push(targetResource);
          } else if (/Questionnaire/.test(def)) {
            // If this is an Questionnaire, resolve it so we can apply it
            const questionnaire = (await resolver(def))[0];

            // Link the Questionnaire's id via the resource element
            applied.resource = {
              reference: questionnaire.resourceType + "/" + questionnaire.id,
            };

            // Apply any overrides based on the elements of the action such as title, description, and dynamicValue.
            // NOTE: [PlanDefinition takes precedence over ActivityDefinition](https://www.hl7.org/fhir/plandefinition.html#12.18.3.4)
            applied = pruneNull({
              ...applied,
              title: act?.title ?? questionnaire?.title,
              description: act?.description ?? questionnaire?.description,
            });

            // TODO: Consider what dynamicValue support would look like for a Questionnaire

            // Bubble up the resources which were generated by this apply operation
            otherResources.push(questionnaire);
          }
        } else if (act?.action) {
          // 5.4. If there are sub-actions then we assume this is a group

          // NOTE: Recursive function call
          const {
            processedActions: subActions,
            otherResources: moreResources,
          } = await processActions(
            act.action,
            patientReference,
            resolver,
            aux,
            evaluateExpression
          );

          // Bubble up the sub-actions and any resources which were created by processing them
          applied.action = subActions;
          moreResources.forEach((mr) => otherResources.push(mr));
        } else {
          // Don't have a definition and don't have sub-actions
          // TODO: Determine if there is anything we need to do for this case
        }

        // Add the applied action to the processed array
        processedActions.push(applied);
      }
    })
  );
  return {
    processedActions: processedActions,
    otherResources: otherResources, // Any resources created as part of action processing
  };
}

/**
 * Apply an ActivityDefinition to a Patient
 * @param {Object} planDefinition - The ActivityDefinition
 * @param {String} patientReference - A reference to the Patient
 * @param {Function} resolver - For resolving references to FHIR resources
 * @param {Object} aux - Auxiliary resources and services
 * @returns {Object} The requested resource
 */
export async function applyActivity(
  activityDefinition,
  patientReference = null,
  resolver = null,
  aux = {}
) {
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
  const Patient = await validate(
    activityDefinition,
    patientReference,
    resolver,
    aux
  );

  // Either use the provided ID generation function or just use a simple counter.
  const getId = aux?.getId ?? getIncrementalId;

  /*----------------------------------------------------------------------------
    1. Create the target resource of the type specified by the kind element and focused on the Patient in context
  ----------------------------------------------------------------------------*/
  let targetResource = {
    id: getId(),
  };

  let patientFhirReference = {
    reference: "Patient/" + Patient.id,
    display: parseName(Patient?.name),
  };

  // https://www.hl7.org/fhir/valueset-request-resource-types.html
  const requestResourceTypes = [
    "Appointment",
    "AppointmentResponse",
    "CarePlan",
    "Claim",
    "CommunicationRequest",
    "Contract",
    "DeviceRequest",
    "EnrollmentRequest",
    "ImmunizationRecommendation",
    "MedicationRequest",
    "NutritionOrder",
    "ServiceRequest",
    "SupplyRequest",
    "Task",
    "VisionPrescription",
  ];
  if (requestResourceTypes.includes(activityDefinition?.kind)) {
    targetResource.resourceType = activityDefinition.kind;
  } else {
    let errMsg =
      "ActivityDefinition.kind must be one of the following resources";
    requestResourceTypes.forEach((rtp, ind) => {
      if (ind == 0) errMsg = errMsg + ": " + rtp;
      else errMsg = errMsg + ", " + rtp;
    });
    throw new Error(errMsg);
  }

  /*----------------------------------------------------------------------------
    2. Set the status of the target resource to draft
  ----------------------------------------------------------------------------*/
  targetResource.status = "draft";

  /*----------------------------------------------------------------------------
    3. Apply the structural elements of the ActivityDefinition to the target resource such as code, timing, doNotPerform, product, quantity, dosage, and so on
  ----------------------------------------------------------------------------*/
  targetResource = {
    ...targetResource,
    basedOn: [{ reference: activityDefinition?.url }],
  };

  // Mappings copied from the CQF-Ruler
  // https://github.com/DBCG/cqf-ruler/blob/v0.6.0/plugin/cr/src/main/java/org/opencds/cqf/ruler/cr/r4/provider/ActivityDefinitionApplyProvider.java
  switch (activityDefinition?.kind) {
    case "ServiceRequest":
      targetResource = {
        ...targetResource,
        subject: patientFhirReference,
        intent: activityDefinition?.intent,
        code: activityDefinition?.code,
        bodySite: activityDefinition?.bodySite,
      };
      break;
    case "MedicationRequest":
      targetResource = {
        ...targetResource,
        subject: patientFhirReference,
        intent: activityDefinition?.intent,
        priority: activityDefinition?.priority,
        dosageInstruction: activityDefinition?.dosage,
      };
      if (activityDefinition?.productCodeableConcept) {
        targetResource.medicationCodeableConcept =
          activityDefinition?.productCodeableConcept;
      } else if (activityDefinition?.productReference) {
        targetResource.medicationReference =
          activityDefinition?.productReference;
      }
      break;
    case "SupplyRequest":
      targetResource = {
        ...targetResource,
        quantity: activityDefinition?.quantity,
        itemCodeableConcept: activityDefinition?.code,
      };
      break;
    case "CommunicationRequest": {
      targetResource = {
        ...targetResource,
        subject: patientFhirReference,
      };

      // Gather payloads
      // https://github.com/DBCG/cqf-ruler/blob/v0.6.0/plugin/cr/src/main/java/org/opencds/cqf/ruler/cr/r4/provider/ActivityDefinitionApplyProvider.java#L386
      // Note: The CQF-Ruler does not create multiple payloads
      const payloads = [];
      if (activityDefinition?.code?.text) {
        payloads.push({ contentString: activityDefinition.code.text });
      }
      if (activityDefinition?.relatedArtifact) {
        for (const relatedArtifact of activityDefinition.relatedArtifact) {
          if (relatedArtifact.url !== undefined) {
            payloads.push({
              contentAttachment: {
                url: relatedArtifact.url,
                title: relatedArtifact.display,
              },
            });
          }
        }
      }
      if (payloads.length > 0) {
        targetResource.payload = payloads;
      }

      break;
    }
    case "Task": {
      targetResource = {
        ...targetResource,
        intent: activityDefinition?.intent,
        for: patientFhirReference,
        code: activityDefinition?.code,
      };
      if (activityDefinition?.code) {
        // https://github.com/DBCG/cqf-ruler/blob/v0.6.0/plugin/cr/src/main/java/org/opencds/cqf/ruler/cr/r4/provider/ActivityDefinitionApplyProvider.java#L422
        // Note: The CQF-Ruler does not create multiple inputs
        const inputs = [];
        const baseInput = { type: activityDefinition.code };

        // Extension defined by CPG-on-FHIR for Questionnaire canonical URI
        const collectWith = activityDefinition?.extension?.find(
          (ext) =>
            ext.url ===
            "http://hl7.org/fhir/uv/cpg/StructureDefinition/cpg-collectWith"
        );
        if (collectWith !== undefined) {
          inputs.push({
            ...baseInput,
            valueCanonical: collectWith.valueCanonical,
          });
        }

        if (activityDefinition?.relatedArtifact) {
          for (const relatedArtifact of activityDefinition.relatedArtifact) {
            if (relatedArtifact.url !== undefined) {
              inputs.push({
                ...baseInput,
                valueAttachment: {
                  url: relatedArtifact.url,
                  title: relatedArtifact.display,
                },
              });
            }
          }
        }

        targetResource.input = inputs;
      }
      break;
    }
    default:
      targetResource = {
        ...targetResource,
        subject: patientFhirReference,
        code: activityDefinition?.code,
        timing: activityDefinition?.timing,
        doNotPerform: activityDefinition?.doNotPerform,
      };
      break;
  }

  targetResource = pruneNull(targetResource);

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

    // if (Array.isArray(activityDefinition?.library)) {
    //   const libRef = activityDefinition.library[0];

    //   // Check aux for objects necessary for CQL execution
    //   let elmJsonDependencies = aux.elmJsonDependencies ?? [];
    //   const valueSetJson = aux.valueSetJson ?? {};
    //   const cqlParameters = aux.cqlParameters ?? {};

    //   const elmJsonKey = Object.keys(elmJsonDependencies).filter(e => libRef.includes(e))[0];
    //   let elmJson = elmJsonDependencies[elmJsonKey];

    let patientResult =
      (await executeCQL(activityDefinition, patientReference, resolver, aux)) ||
      {};
    // Asynchronously evaluate all dynamicValues
    const evaluatedValues = activityDefinition?.dynamicValue.map((dV) => {
      if (dV?.expression?.language != "text/cql") {
        throw new Error(
          "Dynamic value specifies an unsupported expression language"
        );
      }
      const value = patientResult[dV.expression.expression];
      return {
        path: dV.path,
        evaluated: value,
      };
      // TODO: Throw error if expression can't be evaluated (two cases)
    });

    // Copy the values over to the target resource
    targetResource = evaluatedValues.reduce((acc, cv) => {
      let path = transformChoicePaths(targetResource.resourceType, cv.path);
      let value = shouldTryToStringify(cv.path, cv.evaluated)
        ? JSON.stringify(cv.evaluated)
        : cv.evaluated;
      let append = expandPathAndValue(path, value);
      return {
        ...acc,
        ...append,
      };
    }, targetResource);
  }

  return targetResource;
}
