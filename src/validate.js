import { formatErrorMessage } from './utils.js';

/**
 * Validates the input parameters to both apply functions.
 * @param {Object} appliableResource - The FHIR Resource to be applied
 * @param {String} patientReference - A reference to the Patient
 * @param {Function} resolver - For resolving references to FHIR resources
 * @param {Object} aux - Auxiliary resources and services
 * @returns {Object[]} The resolved Patient resource
 */
 export async function validate(appliableResource, patientReference=null, resolver=null, aux={}) {

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
      const fhir_json_schema_validator = await import('@asymmetrik/fhir-json-schema-validator');
      const JSONSchemaValidator = fhir_json_schema_validator.default;
      const validator = new JSONSchemaValidator();
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