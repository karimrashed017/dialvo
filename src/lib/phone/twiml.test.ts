import { describe, expect, it } from "vitest";
import { twiml } from "./twiml";

describe("TwiML", () => {
  it("escapes everything that is spoken or addressed", () => {
    const xml = twiml([
      {
        say: `Tom & "Jerry" <b>hi</b>`,
        voice: "Polly.Joanna-Neural",
        language: "en-US",
      },
      {
        gather: {
          action: "https://x.example/turn?call=1&s=2",
          language: "en-US",
          say: { text: "Next?</Say><Hangup/>", voice: "Polly.Joanna-Neural" },
        },
      },
      { hangup: true },
    ]);
    expect(xml).toContain("Tom &amp; &quot;Jerry&quot; &lt;b&gt;hi&lt;/b&gt;");
    expect(xml).toContain('action="https://x.example/turn?call=1&amp;s=2"');
    expect(xml).toContain("Next?&lt;/Say&gt;&lt;Hangup/&gt;");
    expect(xml).toContain('input="speech"');
    expect(xml).toContain('actionOnEmptyResult="true"');
    expect(xml.match(/<Hangup\/>/g)?.length).toBe(1);
  });

  it("dials the transfer number with our number as caller ID", () => {
    const xml = twiml([
      {
        dial: {
          number: "+15005550009",
          callerId: "+15005550001",
          action: "https://x.example/t",
        },
      },
    ]);
    expect(xml).toContain(
      '<Dial callerId="+15005550001" action="https://x.example/t" method="POST" timeout="20"><Number>+15005550009</Number></Dial>',
    );
  });
});
