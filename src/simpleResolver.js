import { existsSync, readFileSync } from 'fs';
import pkg from 'semver';
const { rcompare } = pkg;

// Source: https://www.hl7.org/fhir/references.html#literal
// NOTE: Added parentheses around the ID portion of the RegExp to allow that 
//       to be pulled out as a match.
// NOTE: Removed the history group from the RegExp and replaced it with one that 
//       tries to match the version for canonical URLs.
// TODO: Make this less ugly or at least hide it in another file.
const restfulFhirUrlRegex = /((http|https):\/\/([A-Za-z0-9\-\\\.\:\%\$]*\/)+)?(Account|ActivityDefinition|AdverseEvent|AllergyIntolerance|Appointment|AppointmentResponse|AuditEvent|Basic|Binary|BiologicallyDerivedProduct|BodyStructure|Bundle|CapabilityStatement|CarePlan|CareTeam|CatalogEntry|ChargeItem|ChargeItemDefinition|Claim|ClaimResponse|ClinicalImpression|CodeSystem|Communication|CommunicationRequest|CompartmentDefinition|Composition|ConceptMap|Condition|Consent|Contract|Coverage|CoverageEligibilityRequest|CoverageEligibilityResponse|DetectedIssue|Device|DeviceDefinition|DeviceMetric|DeviceRequest|DeviceUseStatement|DiagnosticReport|DocumentManifest|DocumentReference|EffectEvidenceSynthesis|Encounter|Endpoint|EnrollmentRequest|EnrollmentResponse|EpisodeOfCare|EventDefinition|Evidence|EvidenceVariable|ExampleScenario|ExplanationOfBenefit|FamilyMemberHistory|Flag|Goal|GraphDefinition|Group|GuidanceResponse|HealthcareService|ImagingStudy|Immunization|ImmunizationEvaluation|ImmunizationRecommendation|ImplementationGuide|InsurancePlan|Invoice|Library|Linkage|List|Location|Measure|MeasureReport|Media|Medication|MedicationAdministration|MedicationDispense|MedicationKnowledge|MedicationRequest|MedicationStatement|MedicinalProduct|MedicinalProductAuthorization|MedicinalProductContraindication|MedicinalProductIndication|MedicinalProductIngredient|MedicinalProductInteraction|MedicinalProductManufactured|MedicinalProductPackaged|MedicinalProductPharmaceutical|MedicinalProductUndesirableEffect|MessageDefinition|MessageHeader|MolecularSequence|NamingSystem|NutritionOrder|Observation|ObservationDefinition|OperationDefinition|OperationOutcome|Organization|OrganizationAffiliation|Patient|PaymentNotice|PaymentReconciliation|Person|PlanDefinition|Practitioner|PractitionerRole|Procedure|Provenance|Questionnaire|QuestionnaireResponse|RelatedPerson|RequestGroup|ResearchDefinition|ResearchElementDefinition|ResearchStudy|ResearchSubject|RiskAssessment|RiskEvidenceSynthesis|Schedule|SearchParameter|ServiceRequest|Slot|Specimen|SpecimenDefinition|StructureDefinition|StructureMap|Subscription|Substance|SubstanceNucleicAcid|SubstancePolymer|SubstanceProtein|SubstanceReferenceInformation|SubstanceSourceMaterial|SubstanceSpecification|SupplyDelivery|SupplyRequest|Task|TerminologyCapabilities|TestReport|TestScript|ValueSet|VerificationResult|VisionPrescription)(\/[A-Za-z0-9\-\.]{1,64})(\|(\d+\.)?(\d+\.)?(\*|\d+))?/;

/**
 * A function that defines a simple FHIR resolver function.
 * @param {string|object|array} input 
 * @returns {function}
 */
export function simpleResolver(input = null) {

  let fhirJson;

  // First check if the input is a string
  if (typeof input ==  'string') {
    // Then check whether this string is a path that exists
    if (existsSync(input)) {
      // If it is, then read it in an deserialize
      fhirJson = JSON.parse(readFileSync(input));
    } else {
      // If it isn't a path, it might be stringified JSON that can be deserialized
      fhirJson = JSON.parse(input);
    }
  } else if (input && typeof input == 'object') { // includes arrays
    fhirJson = input;
  } else {
    fhirJson = [];
  }

  // The function we are returning expects a flat array of FHIR resources
  if (Array.isArray(fhirJson)) {
    fhirJson = fhirJson; // Nothing to do here
  } else if (typeof fhirJson == 'object') {
    // Is this a bundle?
    if (fhirJson?.resourceType == 'Bundle') {
      // Flatten out the entries
      fhirJson = fhirJson?.entry.map(r => r.resource);
    } else if (fhirJson.resourceType) {
      // Is this even a FHIR resource?
      fhirJson = [fhirJson];
    } else {
      fhirJson = [];
    }
  } else {
    fhirJson = [];
  }

  /**
   * A function that resolves a resource via provided reference string.
   * @param {string} resourceReference - A literal or canonical reference.
   * @returns {object[]} resolvedReference - An array of matched resources.
   */
  return function resolver(resourceReference = null) {
    
    // Initialize our resolved references.
    let resolvedReference = [];

    // If a reference is provided, extract the resource type, ID, and version.
    if (resourceReference) {
      // Match the reference against the regular expression
      let [_, baseUrl, ___, ____, resourceType, resourceId, version] = restfulFhirUrlRegex.exec(resourceReference) || [];

      // If enough data could be extracted from `resourceReference`, attempt to search for the resource by ID
      if (resourceType !== undefined && resourceId !== undefined) {
        resourceId = resourceId.split('/')[1]; // strip off leading forward slash

        // Form the url to resource
        // TODO: Refactor RegExp so this just falls out of the match
        let url = baseUrl + resourceType + '/' + resourceId;

        if (version) { // If there is a version we know this is a canonical reference.
          // See: https://www.hl7.org/fhir/references.html#canonical
          version = version.split('|');
          version.shift(); // strip off leading pipe
          resolvedReference = fhirJson.filter(rsrc => {
            return rsrc.resourceType == resourceType 
              && rsrc.url == url
              && rsrc.version == version;
          });
        } else { // No version provided, could be literal/logical or canonical
          const sortedFhirJson = fhirJson.filter(rsrc => {
            return rsrc.resourceType == resourceType 
              && (rsrc.id == resourceId || rsrc.url == url);
          }).sort(compareSemver);
          // NOTE: We're grabbing the first index which should be latest version.
          const shifted = sortedFhirJson.shift();
          resolvedReference = shifted !== undefined ? [shifted] : [];
        }
      }
      else { // Not enough data was extracted, so attempt to search for the resource by an exact URL match
        const sortedFhirJson = fhirJson.filter(rsrc => rsrc.url === resourceReference).sort(compareSemver);
        // NOTE: We're grabbing the first index which should be latest version.
        const shifted = sortedFhirJson.shift();
        resolvedReference = shifted !== undefined ? [shifted] : [];
      }
    } else { // No reference provided so just return fhirJson in its entirety.
      resolvedReference = fhirJson;
    }

    // TODO: Do we really need to return an array?
    return resolvedReference;
  }

}

function compareSemver(a,b) {
  // If either a or b do not have a version element, set a default.
  const aVersion = a.version ?? '0.0.0';
  const bVersion = b.version ?? '0.0.0';
  if (aVersion.split('.').length < 3) {
    aVersion = coerce(aVersion)?.raw || '0.0.0';
  }
  if (bVersion.split('.').length < 3) {
    bVersion = coerce(bVersion)?.raw || '0.0.0';
  }

  return rcompare(aVersion, bVersion);
}