// This function handles forwards netlify form submissions to our register spreadsheets.
// Note that errors are reported in the netlify console, but are _not_ exposed to users who submit the form - they will see successful submission even if this function fails.
//
// This function is automatically called for all form submissions, because it is named exactly submission-create.
// It cannot be manually called by users, and is only callable by Netlify itself.
// If we end up adding multiple forms to the site, we'll need to demux them here in some way and filter out other forms.
//
// The underlying form data is in the body (which is a JSON object) under .payload.data.

import {Auth, google} from "googleapis";

// Each sheet listed here was manually crated, and its spreadsheet ID is taken from its URL.
// Each spreadsheet is expected to contain one sheet per module, named for the module.
// Each module sheet is expected to contain the following columns, in order:
// Name | Email | Timestamp | Course | Module | Day | Location | Build Time
// Each spreadsheet must also give write access to the email listed below in CREDENTIALS.
const COURSE_TO_SPREADSHEET_ID = {
  "itp": "1YHKPCCN55PJD-o1jg4wbVKI3kbhB-ULiwB5hhG17DcA",
  "piscine": "1XabWuYqvOUiY7HpUra0Vdic4pSxmXmNRZHMR72I1bjk",
  "sdc": "1dPY9Troijh3ZZkXbYkMMS3F5TkG4TKdRzd0Z3d45_gI",
};

const CREDENTIALS = {
  // This was generated by:
  //  1. Visit https://console.cloud.google.com/apis/credentials?project=cyf-syllabus
  //  2. Generate or find the service account.
  //  3. Download its credentials as a JSON file.
  //  4. Fetch the keys listed below - the non-env-var ones are not really secret.
  //  5. For private_key, this is read from an env var on netlify, and env vars cannot contain newlines, so we put the string "\n" where we need newlines, accordingly, we undo this below.
  //     The env var was constructed by running: `jq '.private_key' <cyf-syllabus-7ca5140fd0c6.json | tr -d '"'`.
  "private_key": process.env["GOOGLEAPI_REGISTER_PRIVATE_KEY"].replaceAll("\\n", "\n"),
  "client_email": "register@cyf-syllabus.iam.gserviceaccount.com",
  "client_id": "113977060196146055874",
};

const handler = async (event, context) => {
  console.log("Got request with body", event.body);
  let body;
  try {
    // TODO: Check for structure
    body = JSON.parse(event.body);
  } catch (error) {
    console.error(`Failed to parse request as valid JSON: ${event.body}: ${error}`);
    return {statusCode: 400, body: JSON.stringify("Failed to parse body as JSON")};
  }
  if (!("payload" in body) || !("data" in body.payload)) {
    console.error(`Failed to parse request - missing .payload.data: ${event.body}`);
    return {statusCode: 400, body: JSON.stringify("Failed to parse body as JSON")};
  }
  const request = body.payload.data;

  for (const requiredField of ["course", "module", "name", "email", "day", "location", "buildTime"]) {
    if (!(requiredField in request)) {
      const error = `Request missing field ${requiredField}`;
      console.error(error, request);
      return {statusCode: 400, body: JSON.stringify(error)};
    }
    const type = typeof request[requiredField];
    if (type !== "string") {
      const error = `Field ${requiredField} must be of type string but was ${type}`;
      console.error(error, request);
      return {statusCode: 400, body: JSON.stringify(error)};
    }
  }

  if (!(request.course in COURSE_TO_SPREADSHEET_ID)) {
    console.error(`Didn't recognise course ${request.course}`);
    return {statusCode: 404, body: JSON.stringify(`Unknown course: ${request.course}`)};
  }

  const auth = new Auth.GoogleAuth({
    credentials: CREDENTIALS,
    scopes: "https://www.googleapis.com/auth/spreadsheets",
  });

  const sheets = google.sheets({version: "v4", auth});

  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: COURSE_TO_SPREADSHEET_ID[request.course],
      // Trust that the user-supplied module exists.
      // If it's wrong, we'll get a 400 from the API and pass it on to the user without much useful detail.
      range: request.module,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values: [
          [request.name, request.email, new Date().toISOString(), request.course, request.module, request.day, request.location, request.buildTime],
        ],
      },
    });
  } catch (error) {
    console.error("Error from Google API", error);
    let message = "An error occurred signing the register";
    if (error.errors) {
      if ("message" in error.errors[0]) {
        message += ": " + error.errors[0].message;
      }
    }
    return {statusCode: 400, body: JSON.stringify(message)};
  }

  return {
    statusCode: 200,
    body: JSON.stringify("You have successfully signed the register"),
  };
};

export { handler };
