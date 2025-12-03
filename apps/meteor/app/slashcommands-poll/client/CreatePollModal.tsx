import React, { useState } from 'react';
import { Modal, Box, Field, FieldGroup, Button, ButtonGroup } from '@rocket.chat/fuselage';

export const CreatePollModal = ({ onClose }: { onClose: () => void }) => {
    const [question, setQuestion] = useState('');
    const [option1, setOption1] = useState('');
    const [option2, setOption2] = useState('');

    const handleCreate = () => {
        console.log('Poll created!', { question, option1, option2 });
        onClose();
    };

    return (
        <Modal>
            <Modal.Header>
                <Modal.Title>Create a poll</Modal.Title>
                <Modal.Close onClick={onClose} />
            </Modal.Header>
            <Modal.Content>
                <Box>
                    <FieldGroup>
                        <Field>
                            <Field.Label>Question</Field.Label>
                            <Field.Row>
                                <input 
                                    type="text" 
                                    placeholder="Insert your question"
                                    value={question}
                                    onChange={(e) => setQuestion(e.target.value)}
                                    style={{ width: '100%', padding: '8px' }}
                                />
                            </Field.Row>
                        </Field>
                        
                        <Field>
                            <Field.Label>Options</Field.Label>
                            <Field.Row>
                                <input 
                                    type="text" 
                                    placeholder="Insert an option"
                                    value={option1}
                                    onChange={(e) => setOption1(e.target.value)}
                                    style={{ width: '100%', padding: '8px', marginBottom: '8px' }}
                                />
                            </Field.Row>
                            <Field.Row>
                                <input 
                                    type="text" 
                                    placeholder="Insert an option"
                                    value={option2}
                                    onChange={(e) => setOption2(e.target.value)}
                                    style={{ width: '100%', padding: '8px' }}
                                />
                            </Field.Row>
                        </Field>

                        <Field>
                            <Field.Row>
                                <Button>Add a choice</Button>
                            </Field.Row>
                        </Field>

                        <Field>
                            <Field.Row>
                                <select style={{ padding: '8px', marginRight: '8px' }}>
                                    <option>Multiple choices</option>
                                </select>
                                <select style={{ padding: '8px', marginRight: '8px' }}>
                                    <option>Open vote</option>
                                </select>
                                <select style={{ padding: '8px' }}>
                                    <option>Always shows results</option>
                                </select>
                            </Field.Row>
                        </Field>
                    </FieldGroup>
                </Box>
            </Modal.Content>
            <Modal.Footer>
                <ButtonGroup>
                    <Button onClick={onClose}>Dismiss</Button>
                    <Button primary onClick={handleCreate}>Create</Button>
                </ButtonGroup>
            </Modal.Footer>
        </Modal>
    );
};