export class OperationOutcomeMessageListener {
  constructor(messages = null) {
    // Internal map to store unique message combinations
    this.recordedMessages = new Map();
    if(messages){
      this.accumulateMessages(messages);
    }
  }

  /**
   * cql-execution Message Listener implementation
   * @param {Any} source - Source object returned unmodified by the Message operation
   * @param {String} code - Token that is the coded representation of the error
   * @param {String} severity - Token Trace | Message | Warning | Error
   * @param {String} message - content of the actual message that is sent to the calling environment
   * @returns {}
   */
  onMessage(source, code, severity, message) {
    // Create a unique key for the combination of severity, code, and message
    const messageKey = `${severity}|${code}|${message}`;

    // Check if the combination already exists
    if (!this.recordedMessages.has(messageKey)) {
      // If not, add it to the recorded messages
      this.recordedMessages.set(messageKey, { severity, code, message });
    }
  }

  accumulateMessages(messages) {
    messages.forEach(message => {
      this.onMessage(message.source, message.code, message.severity, message.message);
    });
  }

  /**
   * Adds the cqf-meesages extension and contained FHIR OperationOutcome resource instance to the FHIR resource
   * @param {Object} fhirResource - FHIR resource to modify
   * @returns {Object} Modified FHIR resource
   */
  setCqfMessages(fhirResource) {
    const cqfMessagesUri =
      "http://hl7.org/fhir/StructureDefinition/cqf-messages";

    // Ensure the recordedMessages is > 0
    if (this.recordedMessages.size === 0) {
      return fhirResource;
    }

    const containedResource = this.toOperationOutcome();

    // Ensure the input is an object
    if (typeof fhirResource !== "object" || fhirResource === null) {
      throw new Error("Invalid FHIR resource");
    }

    // Initialize the extension array if it doesn't exist
    if (!Array.isArray(fhirResource.extension)) {
      fhirResource.extension = [];
    }

    // Initialize the contained array if it doesn't exist
    if (!Array.isArray(fhirResource.contained)) {
      fhirResource.contained = [];
    }

    // Assign an ID to the contained resource if it doesn't have one
    if (!containedResource.id) {
      containedResource.id = `contained-${fhirResource.contained.length + 1}`;
    }

    // Add the contained resource to the FHIR resource
    fhirResource.contained.push(containedResource);

    // Create a reference to the contained resource
    const reference = {
      reference: `#${containedResource.id}`,
    };

    // Add a new 'cqf-messages' extension, cardinality is 0..*
    fhirResource.extension.push({
      url: cqfMessagesUri,
      valueReference: reference,
    });

    return fhirResource;
  }

  /**
   * Formats the recorded messages as a FHIR OperationOutcome resource instance
   * @returns {Object} FHIR OperationOutcome resource
   */
  toOperationOutcome() {
    // Mapping from input severity to FHIR severity
    const severityMapping = {
      trace: "information",
      error: "error",
      warning: "warning",
      message: "information",
    };

    const issueArray = Array.from(this.recordedMessages.values()).map(
      ({ severity, code, message }) => {
        return {
          severity: severityMapping[severity.toLowerCase()] || "information", // Map to FHIR severity
          code: "processing", // Set code to 'processing'
          diagnostics: message, // Use message as diagnostics
          details: this.codeToDetails(code),
        };
      }
    );

    return {
      resourceType: "OperationOutcome",
      issue: issueArray,
    };
  }

  codeToDetails(code) {
    // Function to check if a string is a valid URI
    const isValidURI = (str) => {
      try {
        new URL(str);
        return true;
      } catch (_) {
        return false;
      }
    };

    let details = {};

    if (isValidURI(code)) {
      // Split the code URI into system and code
      const codeParts = code.split("/");
      const system = codeParts.slice(0, -1).join("/");
      const codeValue = codeParts[codeParts.length - 1];

      details = {
        coding: [
          {
            system: system,
            code: codeValue,
          },
        ],
      };
    } else {
      // If code is not a URI, set details text to the code
      details = {
        text: code,
      };
    }

    return details;
  }
}
