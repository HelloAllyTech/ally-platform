import {
  normaliseCharacterDetails,
  parseCharacterDetails,
} from '../character-details-enhance.util';

const boy = {
  name: 'Arjun',
  age: 22,
  gender: 'male',
  genderIdentity: 'Male/Man',
  sexualOrientation: 'Heterosexual (straight)',
  profession: 'Engineering student',
  currentLocation: 'Pune, India',
};

describe('character details enhance', () => {
  it('reads the studio value', () => {
    expect(parseCharacterDetails(JSON.stringify(boy))).toEqual(boy);
    expect(parseCharacterDetails('Arjun, 22')).toBeNull();
  });

  it('keeps the answer to the form: dropdown values, a numeric age, the same keys', () => {
    const out = normaliseCharacterDetails(
      '```json\n{"name":"Ananya","age":"22","gender":"Female","genderIdentity":"female/woman","sexualOrientation":"Heterosexual (straight)","profession":"Engineering student","currentLocation":"Pune, India","mood":"low"}\n```',
      boy,
    );
    expect(out).toEqual({
      ...boy,
      name: 'Ananya',
      gender: 'female',
      genderIdentity: 'Female/Woman',
    });
    expect(Object.keys(out!)).toEqual(Object.keys(boy));
  });

  it('keeps the original for anything missing or invalid', () => {
    expect(
      normaliseCharacterDetails('{"gender":"girl","age":400,"name":""}', boy),
    ).toEqual(boy);
    expect(normaliseCharacterDetails('no json here', boy)).toBeNull();
  });
});
