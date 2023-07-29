// const cheerio = require('cheerio');
import * as cheerio from 'cheerio';
import clipboard from "clipboardy";
import { parse } from "yaml";
import * as fs from "fs";

const keypress = async () => {
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
        return new Promise(resolve => process.stdin.once('data', data => {
            const byteArray = [...data]
            if (byteArray.length > 0 && byteArray[0] === 3) {
                console.log('^C')
                process.exit(1)
            }
            process.stdin.setRawMode(false)
            resolve()
        }))
    }
    else {
        return Promise.resolve();
    }
}

async function main() {
    let config_file_name = null;

    for(const potential_file_name of [
        "config.yaml",
        "config.yml",
        "default_config.yaml",
        "default_config.yml",
    ]) {
        if(fs.existsSync(potential_file_name)) {
            config_file_name = potential_file_name;
            break;
        }
    }

    if(config_file_name === null) {
        throw Error("No config file found. Please create config.yaml or config.yml");
    }

    const config_text = fs.readFileSync(config_file_name, 'utf8');
    const config = parse(config_text);

    let transcript_url;
    if(process.argv[2]) {
        transcript_url = process.argv[2];
    }
    else if(typeof config.transcript_url === "string" || config.transcript_url instanceof String) {
        transcript_url = config.transcript_url;
    }
    else {
        throw Error("Supply a valid string for the url to the transcript either as the first commandline argument or in the config through the transcript_url property");
    }

    let max_characters = null;
    if(typeof config.max_characters === 'number' || config.max_characters instanceof Number) {
        max_characters = config.max_characters;
    }
    else if('max_characters' in config && config.max_characters !== null) {
        throw Error('max_characters should be a number or null, found: ' + config.max_characters);
    }

    const req = await fetch(transcript_url);
    const text = await req.text();

    const $ = cheerio.load(text);

    let current_chapter = $("h2#chapter0_introduction");
    if(!current_chapter[0]) {
        throw Error("Expected to find an HTML tag matching h2#chapter0_introduction at the supplied url: '" + transcript_url + "', but didn't find one.")
    }

    const prompt_question =
        "Generate questions about the contents of the text below." +
        "Mix multiple choice and open questions, depending on what is appropriate for the question." +
        "Also list the correct answers at the end." +
        (
            max_characters === null ? "" :
            "I will split the text into pieces if it is too long." +
            "If this is the case, just reply with \"understood\" and don't immediately start asking questions."
        ) +
        "Here is the text:\n\n---\n\n";
    const prompt_ending_get_questions =
`

---

This was all text. Now come up with the questions.
`;
    const prompt_ending_more_text =
`

---

More text will follow. For now, just reply with "understood" if you understood the text so far.
`;



    let text_so_far = prompt_question;

    for(let next = current_chapter.next(); true; next = next.next()) {
        const tag_name = next.length > 0 ? next[0].name : null;

        if(tag_name === "h2" || tag_name === null) {
            if(max_characters !== null) {
                text_so_far += prompt_ending_get_questions
            }

            console.log(text_so_far);

            await Promise.all([
                clipboard.write(text_so_far),
                keypress(),
            ]);

            // Reset prompt
            text_so_far = prompt_question;
        }
        else if(tag_name == "div") {
            const next_text = next.text();

            if(max_characters !== null && text_so_far.length + next_text.length + Math.max(prompt_ending_get_questions.length, prompt_ending_more_text.length) > max_characters) {
                text_so_far += prompt_ending_more_text;

                console.log(text_so_far);

                await Promise.all([
                    clipboard.write(text_so_far),
                    keypress(),
                ]);

                text_so_far = "Here is some more text:\n\n---\n\n"
            }

            text_so_far += next_text;
        }
        else {
            throw new Error("Expected the introduction header (h2) in the transcript to be followed by h2's and divs only, found: " + tag_name);
        }

        if(next.length == 0) {
            break;
        }
    }
}

main().then(() => process.exit());