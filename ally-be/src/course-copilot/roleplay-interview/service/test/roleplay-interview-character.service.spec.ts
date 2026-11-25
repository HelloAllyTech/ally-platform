import {
  libraryCharacterFrom,
  RoleplayInterviewCharacterService,
} from '../roleplay-interview-character.service';

const form = {
  name: 'Arjun',
  age: '22',
  gender: 'Male',
  profession: 'Engineering student',
  currentLocation: 'Pune, India',
  characterProfileText: 'Arjun is in his final year…',
  coverImageUrl: 'https://img/cover.png',
  languageVoices: { '1': 'voice-a', bad: 'x', '2': '' },
  linguisticStyleSamples: { '1': ['I guess it is fine.'] },
  knowledgeSources: [
    { id: 'k1', title: 'Family', content: 'Parents in Nagpur.' },
  ],
  prompt: 'not a character field',
};

describe('libraryCharacterFrom', () => {
  it('copies the roleplay form into a library character', () => {
    expect(libraryCharacterFrom(form)).toEqual({
      name: 'Arjun',
      age: 22,
      gender: 'male',
      profession: 'Engineering student',
      currentLocation: 'Pune, India',
      genderIdentity: 'Male/Man',
      sexualOrientation: '',
      characterProfileText: 'Arjun is in his final year…',
      coverImageUrl: 'https://img/cover.png',
      voices: { '1': 'voice-a' },
      linguisticStyleSamples: { '1': ['I guess it is fine.'] },
      knowledgeSources: [
        { id: 'k1', title: 'Family', text: 'Parents in Nagpur.' },
      ],
    });
  });

  it('makes nothing without a name, an age and a gender', () => {
    expect(libraryCharacterFrom({ ...form, name: '' })).toBeNull();
    expect(libraryCharacterFrom({ ...form, gender: 'boy' })).toBeNull();
    expect(libraryCharacterFrom({ ...form, age: 'twenty' })).toBeNull();
  });
});

describe('RoleplayInterviewCharacterService', () => {
  const make = () => {
    const characterService = {
      createScenarioCharacter: jest
        .fn()
        .mockResolvedValue({ id: 'c-1', name: 'Arjun' }),
      updateScenarioCharacter: jest
        .fn()
        .mockResolvedValue({ id: 'c-1', name: 'Ananya' }),
    };
    return {
      service: new RoleplayInterviewCharacterService(characterService as any),
      characterService,
    };
  };
  const session = (brief: any = {}) => ({ id: 's-1', brief }) as any;

  it('adds a new character the first time', async () => {
    const { service, characterService } = make();
    await expect(service.saveCharacter(session(), form)).resolves.toEqual({
      id: 'c-1',
      name: 'Arjun',
    });
    expect(characterService.createScenarioCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Arjun', gender: 'male' }),
    );
  });

  it('updates the same library character after a change, never a duplicate', async () => {
    const { service, characterService } = make();
    const result = await service.saveCharacter(
      session({ savedCharacter: { id: 'c-1', name: 'Arjun' } }),
      { ...form, name: 'Ananya', gender: 'female' },
    );
    expect(result).toEqual({ id: 'c-1', name: 'Ananya' });
    expect(characterService.updateScenarioCharacter).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({
        gender: 'female',
        genderIdentity: 'Female/Woman',
      }),
    );
    expect(characterService.createScenarioCharacter).not.toHaveBeenCalled();
  });

  it('adds it again when the earlier one is gone', async () => {
    const { service, characterService } = make();
    characterService.updateScenarioCharacter.mockRejectedValue(
      new Error('not found'),
    );
    await service.saveCharacter(
      session({ savedCharacter: { id: 'gone', name: 'Arjun' } }),
      form,
    );
    expect(characterService.createScenarioCharacter).toHaveBeenCalled();
  });

  it('never copies a library character', async () => {
    const { service, characterService } = make();
    await expect(
      service.saveCharacter(session({ client: { characterId: 'ch-1' } }), form),
    ).resolves.toBeNull();
    expect(characterService.createScenarioCharacter).not.toHaveBeenCalled();
  });
});
